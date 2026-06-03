import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AppConfig } from './types.js';

const DEFAULTS: AppConfig = {
  port: 4317,
  pollSeconds: 5,
  activeWindowSeconds: 300,
  contextWindow: 0,
  remoteCacheSeconds: 30,
  hosts: [{ name: '本机', type: 'local' }],
};

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
  return path.join(base, 'claude-usage', 'hosts.json');
}

export function loadConfig(): AppConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      ...DEFAULTS,
      ...parsed,
      hosts: Array.isArray(parsed.hosts) && parsed.hosts.length ? parsed.hosts : DEFAULTS.hosts,
    };
  } catch {
    return DEFAULTS;
  }
}
