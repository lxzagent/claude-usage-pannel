import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { cachedContextWindow, contextPct, resolveContextWindow } from './context-window.js';
import { costUsd } from './pricing.js';
import type { CostBucket, CostWindows, SessionInfo, TokenCounts } from './types.js';

const FIVE_H_MS = 5 * 3600_000;
const DAY_MS = 24 * 3600_000;
const WEEK_MS = 7 * DAY_MS;

function projectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

// 列出 mtime 在 maxAgeMs 内的全部 transcript 文件。
function listTranscriptFiles(maxAgeMs: number, now: number): string[] {
  const root = projectsDir();
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return [];
  }
  const cutoff = now - maxAgeMs;
  const files: string[] = [];
  for (const d of dirs) {
    const dir = path.join(root, d);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      try {
        const st = fs.statSync(fp);
        if (st.isFile() && st.mtimeMs >= cutoff) files.push(fp);
      } catch {
        // 跳过无法 stat 的文件
      }
    }
  }
  return files;
}

async function parseSession(file: string, override: number): Promise<SessionInfo | null> {
  const cum: TokenCounts = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let lastUsage: TokenCounts | null = null;
  let peakContext = 0;
  let model = '';
  let cwd = '';
  let lastActiveAt = '';

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
      if (e.type === 'assistant' && e.message?.usage) {
        const u = e.message.usage;
        const counts: TokenCounts = {
          input: num(u.input_tokens),
          output: num(u.output_tokens),
          cacheWrite: num(u.cache_creation_input_tokens),
          cacheRead: num(u.cache_read_input_tokens),
        };
        cum.input += counts.input;
        cum.output += counts.output;
        cum.cacheWrite += counts.cacheWrite;
        cum.cacheRead += counts.cacheRead;
        lastUsage = counts;
        peakContext = Math.max(peakContext, counts.input + counts.cacheRead + counts.cacheWrite);
        if (typeof e.message.model === 'string') model = e.message.model;
        if (typeof e.timestamp === 'string') lastActiveAt = e.timestamp;
      }
    }
  } catch {
    return null;
  }

  if (!lastUsage) return null;
  // 当前上下文占用 ≈ 最近一次请求送入的 input + 命中缓存 + 新建缓存。
  const contextTokens = lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite;
  const sessionId = path.basename(file, '.jsonl');
  // statusline 记录器落盘的精确窗口大小（自包含）；无则回退启发式。
  const window = resolveContextWindow(model, peakContext, override, cachedContextWindow(sessionId));

  return {
    sessionId,
    project: cwd ? path.basename(cwd) : path.basename(path.dirname(file)),
    cwd,
    model,
    contextTokens,
    contextWindow: window,
    contextPct: contextPct(contextTokens, window),
    lastActiveAt,
    cumulativeTokens: cum,
    costUsd: costUsd(model, cum),
  };
}

export async function scanActiveSessions(
  activeWindowSeconds: number,
  now = Date.now(),
  contextWindowOverride = 0
): Promise<SessionInfo[]> {
  const files = listTranscriptFiles(activeWindowSeconds * 1000, now);
  const sessions = await Promise.all(files.map((f) => parseSession(f, contextWindowOverride)));
  return sessions
    .filter((s): s is SessionInfo => s !== null)
    .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
}

function emptyBucket(): CostBucket {
  return { tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, usd: 0 };
}

function addToBucket(b: CostBucket, c: TokenCounts, usd: number): void {
  b.tokens.input += c.input;
  b.tokens.output += c.output;
  b.tokens.cacheWrite += c.cacheWrite;
  b.tokens.cacheRead += c.cacheRead;
  b.usd += usd;
}

async function accumulateFileCost(file: string, now: number, w: CostWindows): Promise<void> {
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let model = '';
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type !== 'assistant' || !e.message?.usage) continue;
      if (typeof e.message.model === 'string') model = e.message.model;
      const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
      if (Number.isNaN(ts)) continue;
      const age = now - ts;
      if (age < 0 || age > WEEK_MS) continue;
      const u = e.message.usage;
      const counts: TokenCounts = {
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheWrite: num(u.cache_creation_input_tokens),
        cacheRead: num(u.cache_read_input_tokens),
      };
      const usd = costUsd(model, counts);
      if (age <= FIVE_H_MS) addToBucket(w.fiveHour, counts, usd);
      if (age <= DAY_MS) addToBucket(w.day, counts, usd);
      addToBucket(w.week, counts, usd);
    }
  } catch {
    // 单文件失败不影响整体
  }
}

// 滚动窗口成本扫描较重（覆盖近 7 天），在进程内缓存以避开 5s 轮询热路径。
let costCache: { at: number; windows: CostWindows } | null = null;
const COST_CACHE_TTL_MS = 60_000;

export async function computeCostWindows(now = Date.now()): Promise<CostWindows> {
  if (costCache && now - costCache.at < COST_CACHE_TTL_MS) {
    return costCache.windows;
  }
  const windows: CostWindows = { fiveHour: emptyBucket(), day: emptyBucket(), week: emptyBucket() };
  for (const file of listTranscriptFiles(WEEK_MS, now)) {
    await accumulateFileCost(file, now, windows);
  }
  costCache = { at: now, windows };
  return windows;
}
