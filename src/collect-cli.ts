// SSH 注入入口：经 `ssh host 'node -' < collector.bundle.cjs` 在远端执行，
// 打印一份 HostSnapshot JSON 到 stdout。仅依赖 Node 内置模块。
import { collectLocal } from './collect.js';

function numArg(name: string, def: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return def;
  const n = Number(hit.slice(prefix.length));
  return Number.isFinite(n) && n > 0 ? n : def;
}

collectLocal({
  activeWindowSeconds: numArg('active-window', 300),
  contextWindow: numArg('context-window', 0),
})
  .then((snap) => process.stdout.write(JSON.stringify(snap)))
  .catch((err) => {
    process.stderr.write(String(err?.message ?? err));
    process.exit(1);
  });
