import { homedir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { saveConfig, loadConfig } from '../cli/config.js';
import { Api } from '../cli/api.js';
import { upsertMcpEntry, removeMcpEntry } from './claude-config.js';
import { installSkill, uninstallSkill, type InstallStatus } from './skill-install.js';

const CFG_REL = '.agentcrew/config.json';
const CC_REL = '.claude.json';

export interface InitOpts { upgrade?: boolean; uninstall?: boolean }

export async function runInit(opts: InitOpts = {}): Promise<void> {
  return runInitWithHome(homedir(), opts);
}

export async function runInitWithHome(home: string, opts: InitOpts = {}): Promise<void> {
  const cfgPath = join(home, CFG_REL);
  const ccPath = join(home, CC_REL);

  if (opts.uninstall) {
    uninstallSkill(home);
    removeMcpEntry(ccPath);
    process.stdout.write('uninstalled.\n');
    return;
  }

  if (opts.upgrade) {
    const status = installSkill(home, { force: true });
    process.stdout.write(`skill: ${status}\n`);
    return;
  }

  const existing = loadConfig(cfgPath) ?? { serverUrl: '' };
  const serverUrl = (await prompts({ type: 'text', name: 'v', message: 'Server URL', initial: existing.serverUrl })).v as string;
  const email = (await prompts({ type: 'text', name: 'v', message: 'Email' })).v as string;
  const password = (await prompts({ type: 'password', name: 'v', message: 'Password' })).v as string;
  const defaultProject = (await prompts({ type: 'text', name: 'v', message: 'Default project slug (optional)' })).v as string;

  const api = new Api({ serverUrl });
  try { await api.request('POST', '/v1/auth/signup', { email, password }); } catch { /* may already exist */ }
  const { token: sessionToken } = await api.request<{ token: string }>(
    'POST', '/v1/auth/login', { email, password },
  );

  const authed = new Api({ serverUrl, token: sessionToken });
  const { raw: apiKey } = await authed.request<{ id: string; raw: string }>(
    'POST', '/v1/auth/keys', { name: `init-${new Date().toISOString().slice(0, 10)}` },
  );

  saveConfig(cfgPath, {
    serverUrl, token: sessionToken,
    defaultProject: defaultProject || undefined,
  });
  process.stdout.write(`✓ wrote ${cfgPath}\n`);

  const skillStatus: InstallStatus = installSkill(home);
  if (skillStatus === 'different') {
    const ok = (await prompts({ type: 'confirm', name: 'v', message: 'SKILL.md has local edits. Overwrite?' })).v as boolean;
    if (ok) installSkill(home, { force: true });
  }
  process.stdout.write(`✓ wrote ${join(home, '.claude/skills/agentcrew/SKILL.md')}\n`);

  upsertMcpEntry(ccPath, { url: `${serverUrl.replace(/\/$/, '')}/mcp`, token: apiKey });
  process.stdout.write(`✓ registered MCP server in ${ccPath}\n`);

  const projects = await new Api({ serverUrl, token: apiKey }).request<any[]>('GET', '/v1/projects');
  process.stdout.write(`✓ verified connection (${projects.length} projects)\n`);
  process.stdout.write('\nRestart Claude Code to pick up the new skill.\n');
}
