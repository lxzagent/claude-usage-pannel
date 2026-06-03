// 推断会话上下文窗口大小。
// transcript 不记录窗口大小（Claude Code 仅在 statusline 的 stdin 中提供），
// 故采用三级推断：配置覆盖 > 观测溢出（峰值 > 20 万必为 1M 窗口）> model 含 [1m] > 默认 20 万。
export function resolveContextWindow(model: string, peakTokens: number, override = 0): number {
  if (override > 0) return override;
  if (peakTokens > 200_000) return 1_000_000;
  if (/\[1m\]/i.test(model)) return 1_000_000;
  return 200_000;
}

export function contextPct(tokens: number, window: number): number {
  if (window <= 0) return 0;
  return Math.min(100, Math.round((tokens / window) * 100));
}
