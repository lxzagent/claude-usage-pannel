import * as https from 'node:https';
import type { AccountError, AccountUsage } from './types.js';
import { planName, readCredentials } from './credentials.js';

const HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60_000; // 对齐官方限流窗口

interface CacheEntry {
  at: number;
  account: AccountUsage | null;
  error?: AccountError;
}
let cache: CacheEntry | null = null;

function usingCustomEndpoint(): boolean {
  const base = (process.env.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_API_BASE_URL ?? '').trim();
  if (!base) return false;
  try {
    return new URL(base).origin !== 'https://api.anthropic.com';
  } catch {
    return true;
  }
}

function clampPct(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(100, v)));
}

function isoDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fetchUsage(token: string): Promise<{ data?: any; error?: AccountError }> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: HOST,
        path: USAGE_PATH,
        method: 'GET',
        timeout: TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve({ data: JSON.parse(body) });
            } catch {
              resolve({ error: 'api-error' });
            }
          } else if (res.statusCode === 429) {
            resolve({ error: 'rate-limited' });
          } else {
            resolve({ error: 'api-error' });
          }
        });
      }
    );
    req.on('error', () => resolve({ error: 'api-error' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'api-error' });
    });
    req.end();
  });
}

export async function getAccountUsage(
  now = Date.now()
): Promise<{ account: AccountUsage | null; error?: AccountError }> {
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { account: cache.account, error: cache.error };
  }

  if (usingCustomEndpoint()) {
    cache = { at: now, account: null, error: 'custom-endpoint' };
    return { account: null, error: 'custom-endpoint' };
  }

  const { credentials, error: credError } = readCredentials(now);
  if (!credentials) {
    // 凭证类错误不长缓存（钥匙串可能随时解锁）。
    return { account: null, error: credError };
  }

  const plan = planName(credentials.subscriptionType);
  if (!plan) {
    return { account: null, error: 'api-user' };
  }

  const res = await fetchUsage(credentials.accessToken);
  if (res.error || !res.data) {
    // API 异常时回退上次好值。
    if (cache?.account) return { account: cache.account, error: res.error };
    return { account: null, error: res.error };
  }

  const account: AccountUsage = {
    plan,
    fiveHour: res.data.five_hour
      ? { pct: clampPct(res.data.five_hour.utilization) ?? 0, resetsAt: isoDate(res.data.five_hour.resets_at) }
      : null,
    sevenDay: res.data.seven_day
      ? { pct: clampPct(res.data.seven_day.utilization) ?? 0, resetsAt: isoDate(res.data.seven_day.resets_at) }
      : null,
  };
  cache = { at: now, account };
  return { account };
}
