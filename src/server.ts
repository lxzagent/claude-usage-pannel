import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from './aggregator.js';
import { configPath, loadConfig } from './config.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const cfg = loadConfig();

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/api/stats') {
    try {
      const data = await aggregate(cfg);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ...data, pollSeconds: cfg.pollSeconds }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const fp = path.join(PUBLIC_DIR, rel);
  if (!fp.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(fp, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] ?? 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`claude-usage 面板 → http://127.0.0.1:${cfg.port}`);
  console.log(`配置文件: ${configPath()}  (主机数: ${cfg.hosts.length})`);
});
