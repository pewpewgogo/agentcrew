import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  serverUrl: string;
  token?: string;
  defaultProject?: string;
}

export const DEFAULT_CONFIG_PATH = `${homedir()}/.agentcrew/config.json`;

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): Config | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Config;
}

export function saveConfig(path: string = DEFAULT_CONFIG_PATH, cfg: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
  try { chmodSync(path, 0o600); } catch { /* not critical on non-posix */ }
}

export function requireConfig(path: string = DEFAULT_CONFIG_PATH): Config {
  const c = loadConfig(path);
  if (!c?.token) throw new Error('Not logged in. Run `cs login` or `npx agentcrew init` first.');
  return c;
}
