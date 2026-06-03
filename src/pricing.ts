import type { TokenCounts } from './types.js';

// 近似单价，USD / 每百万 token。官方价格会变动，按需手动维护。
interface Rate {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const RATES: Record<'opus' | 'sonnet' | 'haiku', Rate> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

function rateFor(model: string): Rate {
  const m = model.toLowerCase();
  if (m.includes('opus')) return RATES.opus;
  if (m.includes('haiku')) return RATES.haiku;
  return RATES.sonnet; // 未知/默认按 sonnet 估算
}

export function costUsd(model: string, t: TokenCounts): number {
  const r = rateFor(model);
  return (
    (t.input * r.input +
      t.output * r.output +
      t.cacheWrite * r.cacheWrite +
      t.cacheRead * r.cacheRead) /
    1_000_000
  );
}
