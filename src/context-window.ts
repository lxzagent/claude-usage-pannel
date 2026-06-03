import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 推断会话上下文窗口大小。
// transcript 不记录窗口大小（Claude Code 仅在 statusline 的 stdin 里给 context_window.context_window_size），
// 故优先用本项目 statusline 记录器（~/.config/claude-usage/statusline.sh）落盘的精确值，其余按启发式回退。
// 优先级：配置覆盖 > 观测溢出(峰值>20万必为1M) > statusline 记录的精确值 > model 含 [1m] > 默认 20 万。

function contextCacheDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
  return path.join(base, 'claude-usage', 'context-cache');
}

// 读取 statusline 记录器写下的精确窗口大小；无 / 损坏返回 0。自包含，不读 claude-hud 任何文件。
export function cachedContextWindow(sessionId: string): number {
  if (!sessionId) return 0;
  try {
    const raw = fs.readFileSync(path.join(contextCacheDir(), `${sessionId}.json`), 'utf8');
    const size = JSON.parse(raw).context_window_size;
    return typeof size === 'number' && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

export function resolveContextWindow(
  model: string,
  peakTokens: number,
  override = 0,
  cached = 0
): number {
  if (override > 0) return override; // 配置强制
  if (peakTokens > 200_000) return 1_000_000; // 物理事实：用量已超 20 万 → 必为 1M 窗口
  if (cached > 0) return cached; // statusline 记录的精确值
  if (/\[1m\]/i.test(model)) return 1_000_000;
  return 200_000;
}

export function contextPct(tokens: number, window: number): number {
  if (window <= 0) return 0;
  return Math.min(100, Math.round((tokens / window) * 100));
}
