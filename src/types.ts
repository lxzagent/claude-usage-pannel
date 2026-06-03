export interface CollectOptions {
  activeWindowSeconds: number;
  contextWindow?: number; // >0 时覆盖窗口推断
  now?: number;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface AccountUsage {
  plan: string;
  fiveHour: { pct: number; resetsAt: string | null } | null;
  sevenDay: { pct: number; resetsAt: string | null } | null;
}

export type AccountError =
  | 'no-credentials'
  | 'keychain-locked'
  | 'token-expired'
  | 'api-user'
  | 'api-error'
  | 'rate-limited'
  | 'custom-endpoint';

export interface SessionInfo {
  sessionId: string;
  project: string;
  cwd: string;
  model: string;
  contextTokens: number;
  contextWindow: number;
  contextPct: number;
  lastActiveAt: string;
  cumulativeTokens: TokenCounts;
  costUsd: number;
}

export interface CostBucket {
  tokens: TokenCounts;
  usd: number;
}

// 按消息 timestamp 分桶的滚动窗口成本（与官方 5h/周额度口径对齐）。
export interface CostWindows {
  fiveHour: CostBucket;
  day: CostBucket;
  week: CostBucket;
}

export interface HostSnapshot {
  name: string;
  ok: boolean;
  error?: string;
  account: AccountUsage | null;
  accountError?: AccountError;
  sessions: SessionInfo[];
  cost: CostWindows;
  collectedAt: string;
}

export interface HostConfig {
  name: string;
  type: 'local' | 'ssh';
  ssh?: string;
}

export interface AppConfig {
  port: number;
  pollSeconds: number;
  activeWindowSeconds: number;
  contextWindow: number; // 0 = 自动推断
  remoteCacheSeconds: number;
  hosts: HostConfig[];
}
