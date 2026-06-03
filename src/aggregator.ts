import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLocal } from './collect.js';
import type { AppConfig, CostWindows, HostConfig, HostSnapshot } from './types.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// 打包后的采集器位于项目根（src/ 与 dist/ 的上一级均为根）。
const BUNDLE_PATH = path.resolve(dirname, '..', 'collector.bundle.cjs');

const SSH_TIMEOUT_MS = 12_000;

interface CacheEntry {
  at: number;
  snap: HostSnapshot;
}
const remoteCache = new Map<string, CacheEntry>();

function emptyBucket() {
  return { tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, usd: 0 };
}
function emptyCost(): CostWindows {
  return { fiveHour: emptyBucket(), day: emptyBucket(), week: emptyBucket() };
}

function errorSnapshot(name: string, error: string): HostSnapshot {
  return {
    name,
    ok: false,
    error: error.slice(0, 300),
    account: null,
    sessions: [],
    cost: emptyCost(),
    collectedAt: new Date().toISOString(),
  };
}

function collectRemote(host: HostConfig, cfg: AppConfig): Promise<HostSnapshot> {
  return new Promise((resolve) => {
    let bundle: string;
    try {
      bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
    } catch {
      resolve(errorSnapshot(host.name, `collector bundle missing: ${BUNDLE_PATH} (运行 npm run build:collector)`));
      return;
    }

    const args = [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      host.ssh as string,
      `node - --active-window=${cfg.activeWindowSeconds} --context-window=${cfg.contextWindow}`,
    ];

    const child = execFile(
      'ssh',
      args,
      { timeout: SSH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve(errorSnapshot(host.name, stderr?.trim() || err.message));
          return;
        }
        try {
          const snap = JSON.parse(stdout) as HostSnapshot;
          snap.name = host.name;
          resolve(snap);
        } catch {
          resolve(errorSnapshot(host.name, `bad collector output: ${stdout.slice(0, 120)}`));
        }
      }
    );
    child.stdin?.write(bundle);
    child.stdin?.end();
  });
}

async function snapshotForHost(host: HostConfig, cfg: AppConfig, now: number): Promise<HostSnapshot> {
  if (host.type === 'local') {
    const snap = await collectLocal({
      activeWindowSeconds: cfg.activeWindowSeconds,
      contextWindow: cfg.contextWindow,
      now,
    });
    snap.name = host.name;
    return snap;
  }

  if (!host.ssh) {
    return errorSnapshot(host.name, 'ssh host missing "ssh" field');
  }

  const cached = remoteCache.get(host.name);
  if (cached && now - cached.at < cfg.remoteCacheSeconds * 1000) {
    return cached.snap;
  }
  const snap = await collectRemote(host, cfg);
  remoteCache.set(host.name, { at: now, snap });
  return snap;
}

export async function aggregate(cfg: AppConfig): Promise<{ hosts: HostSnapshot[]; generatedAt: string }> {
  const now = Date.now();
  const hosts = await Promise.all(cfg.hosts.map((h) => snapshotForHost(h, cfg, now)));
  return { hosts, generatedAt: new Date(now).toISOString() };
}
