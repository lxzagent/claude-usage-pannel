import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
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

// 跨进程共享缓存：daemon / collect CLI / 远端 SSH 各是独立进程，内存缓存互不相通，
// 会各自去打 OAuth usage 接口 → 429。落盘让它们共享同一个 5 分钟窗口。只存成功结果（不存错误/凭证）。
function diskCacheFile(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
  return path.join(base, 'claude-usage', 'usage-cache.json');
}

function readDiskCache(now: number): CacheEntry | null {
  try {
    const e = JSON.parse(fs.readFileSync(diskCacheFile(), 'utf8'));
    if (e && typeof e.at === 'number' && e.account && now - e.at < CACHE_TTL_MS) {
      return { at: e.at, account: e.account };
    }
  } catch {
    // 无缓存 / 损坏 / 已过期 → 视为未命中
  }
  return null;
}

// 忽略 TTL 读最后一次成功的额度值，仅用于 token-stale（待刷新）时维持展示，避免误报「过期」。
function lastGoodAccount(): AccountUsage | null {
  try {
    const e = JSON.parse(fs.readFileSync(diskCacheFile(), 'utf8'));
    return e && e.account ? e.account : null;
  } catch {
    return null;
  }
}

function writeDiskCache(entry: CacheEntry): void {
  try {
    const f = diskCacheFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, f); // 原子替换，避免并发进程读到半截
  } catch {
    // 落盘失败不影响功能
  }
}

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

  // 跨进程命中：远端 SSH / CLI 每次都是新进程，内存缓存为空，先看落盘缓存。
  const disk = readDiskCache(now);
  if (disk) {
    cache = disk;
    return { account: disk.account };
  }

  if (usingCustomEndpoint()) {
    cache = { at: now, account: null, error: 'custom-endpoint' };
    return { account: null, error: 'custom-endpoint' };
  }

  const { credentials, error: credError } = readCredentials(now);
  if (!credentials) {
    // token-stale：access token 过期但有 refreshToken，账号健康。不报错，沿用最后一次成功的额度值
    // （内存优先，其次落盘且忽略 TTL），等 Claude Code 下次活动自动刷新即恢复。
    if (credError === 'token-stale') {
      return { account: cache?.account ?? lastGoodAccount(), error: 'token-stale' };
    }
    // 其它凭证类错误不长缓存（钥匙串可能随时解锁）。
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
  writeDiskCache(cache); // 让其它进程（远端/CLI/重启后的 daemon）复用同一窗口
  return { account };
}
