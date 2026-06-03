#!/usr/bin/env node
// claude-usage statusline 记录器（自包含，不依赖 claude-hud）。
// 从 statusline stdin JSON 抓 context_window.context_window_size（200000/1000000 精确值），
// 按 session_id 写到 ~/.config/claude-usage/context-cache/<session_id>.json，供面板读取。
// transcript JSONL 不含窗口大小，只有 statusline stdin 才有；故用本记录器落盘补上这一信息。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
const CACHE_DIR = path.join(base, 'claude-usage', 'context-cache');
const WRITE_TTL_MS = 3000; // statusline ~300ms 一跳，节流磁盘写
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

function sweep() {
  try {
    const now = Date.now();
    const survivors = [];
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(CACHE_DIR, f);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > MAX_AGE_MS) { fs.unlinkSync(full); continue; }
        survivors.push({ full, m: st.mtimeMs });
      } catch {}
    }
    if (survivors.length > MAX_ENTRIES) {
      survivors.sort((a, b) => a.m - b.m);
      for (let i = 0; i < survivors.length - MAX_ENTRIES; i++) {
        try { fs.unlinkSync(survivors[i].full); } catch {}
      }
    }
  } catch {}
}

function main() {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  let s;
  try { s = JSON.parse(raw.trim()); } catch { return; }
  const cw = s && s.context_window;
  const sessionId = s && s.session_id;
  if (!cw || typeof sessionId !== 'string' || !sessionId) return;
  const size = cw.context_window_size;
  if (typeof size !== 'number' || size <= 0) return; // 仅在拿到真实窗口大小时写

  const file = path.join(CACHE_DIR, sessionId + '.json');
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < WRITE_TTL_MS) return; // 近 3s 内写过，跳过
  } catch {}
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload = {
      session_id: sessionId,
      transcript_path: typeof s.transcript_path === 'string' ? s.transcript_path : null,
      context_window_size: size,
      used_percentage: typeof cw.used_percentage === 'number' ? cw.used_percentage : null,
      model_id: s.model && typeof s.model.id === 'string' ? s.model.id : null,
      saved_at: Date.now(),
    };
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, file); // 原子替换
    if (Math.random() < 0.05) sweep();
  } catch {}
}

main();
