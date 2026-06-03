import { computeCostWindows, scanActiveSessions } from './sessions.js';
import type { CollectOptions, HostSnapshot } from './types.js';
import { getAccountUsage } from './usage.js';

// 采集本机一份 HostSnapshot：account 需凭证，sessions/cost 仅读 JSONL，二者独立成败。
export async function collectLocal(opts: CollectOptions): Promise<HostSnapshot> {
  const now = opts.now ?? Date.now();
  const [{ account, error: accountError }, sessions, cost] = await Promise.all([
    getAccountUsage(now),
    scanActiveSessions(opts.activeWindowSeconds, now, opts.contextWindow ?? 0),
    computeCostWindows(now),
  ]);

  return {
    name: 'local',
    ok: true,
    account,
    accountError,
    sessions,
    cost,
    collectedAt: new Date(now).toISOString(),
  };
}
