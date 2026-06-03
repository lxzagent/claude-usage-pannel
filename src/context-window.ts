import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 推断会话上下文窗口大小。
// transcript 不记录窗口大小（Claude Code 仅在 statusline 的 stdin 里给 context_window.context_window_size），
// 故优先用本项目 statusline 记录器（~/.config/claude-usage/statusline.sh）落盘的精确值，其余按启发式回退。
// 优先级：配置覆盖 > 观测溢出(峰值>20万必为1M) > statusline 记录的精确值 > 默认 1M。
// 默认按 1M 估，原因：transcript 的 message.model 永远是裸 id（如 claude-opus-4-8，从不带 [1m] 后缀），
// 且 VSCode 插件会话不执行自定义 statusLine → 拿不到精确窗口。两者叠加会把 1M 会话误判成 20 万，
// 故无精确信号时默认 1M（这正是当前主力用法）。需强制 20 万请设 contextWindow 配置覆盖。

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
  peakTokens: number,
  override = 0,
  cached = 0
): number {
  if (override > 0) return override; // 配置强制
  if (peakTokens > 200_000) return 1_000_000; // 物理事实：用量已超 20 万 → 必为 1M 窗口
  if (cached > 0) return cached; // statusline 记录的精确值（最权威，可能是 20 万也可能是 1M）
  return 1_000_000; // 无精确信号时默认 1M（见文件头说明；需 20 万请用 contextWindow 覆盖）
}

export function contextPct(tokens: number, window: number): number {
  if (window <= 0) return 0;
  return Math.min(100, Math.round((tokens / window) * 100));
}
