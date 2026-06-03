import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AccountError } from './types.js';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

export interface Credentials {
  accessToken: string;
  subscriptionType: string;
}

export interface CredentialsResult {
  credentials: Credentials | null;
  error?: AccountError;
}

function claudeConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  return env || path.join(os.homedir(), '.claude');
}

function credentialsFilePath(): string {
  return path.join(claudeConfigDir(), '.credentials.json');
}

// 返回 'expired' 以便上层区分过期与缺失。
function parse(data: any, now: number): Credentials | 'expired' | null {
  const oauth = data?.claudeAiOauth;
  const accessToken = oauth?.accessToken;
  if (!accessToken) return null;
  const expiresAt = oauth?.expiresAt;
  if (expiresAt != null && expiresAt <= now) return 'expired';
  return { accessToken, subscriptionType: oauth?.subscriptionType ?? '' };
}

function fromFile(now: number): Credentials | 'expired' | null {
  try {
    const p = credentialsFilePath();
    if (!fs.existsSync(p)) return null;
    return parse(JSON.parse(fs.readFileSync(p, 'utf8')), now);
  } catch {
    return null;
  }
}

// 仅 macOS。非交互 SSH 会话钥匙串常被锁，失败即返回 null。
function fromKeychain(now: number): Credentials | 'expired' | null {
  if (process.platform !== 'darwin') return null;
  try {
    const account = os.userInfo().username;
    const out = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 }
    );
    return parse(JSON.parse(out.trim()), now);
  } catch {
    return null;
  }
}

export function readCredentials(now = Date.now()): CredentialsResult {
  // macOS 2.x 以钥匙串为权威，其次文件（Linux / 旧版）。
  const kc = fromKeychain(now);
  if (kc && kc !== 'expired') return { credentials: kc };

  const file = fromFile(now);
  if (file && file !== 'expired') return { credentials: file };

  if (kc === 'expired' || file === 'expired') {
    return { credentials: null, error: 'token-expired' };
  }
  // 钥匙串拿不到且没有凭证文件 → macOS 多半是非交互会话锁库。
  if (process.platform === 'darwin' && !fs.existsSync(credentialsFilePath())) {
    return { credentials: null, error: 'keychain-locked' };
  }
  return { credentials: null, error: 'no-credentials' };
}

export function planName(subscriptionType: string): string | null {
  const s = subscriptionType.toLowerCase();
  if (s.includes('max')) return 'Max';
  if (s.includes('pro')) return 'Pro';
  if (s.includes('team')) return 'Team';
  if (!subscriptionType || s.includes('api')) return null; // API 用户无订阅额度
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}
