import type { Command } from 'commander';
import prompts from 'prompts';
import { loadConfig, saveConfig, DEFAULT_CONFIG_PATH } from '../config.js';
import { Api } from '../api.js';

export function registerLogin(program: Command): void {
  program.command('login')
    .description('login with email + password and store session token')
    .option('-s, --server <url>', 'server URL')
    .action(async (opts) => {
      const existing = loadConfig() ?? { serverUrl: '' };
      const serverUrl: string = opts.server ?? existing.serverUrl ?? (await prompts({ type: 'text', name: 'v', message: 'Server URL' })).v;
      const email = (await prompts({ type: 'text', name: 'v', message: 'Email' })).v as string;
      const password = (await prompts({ type: 'password', name: 'v', message: 'Password' })).v as string;
      const api = new Api({ serverUrl });
      try {
        await api.request('POST', '/v1/auth/signup', { email, password });
      } catch { /* user may already exist */ }
      const { token } = await api.request<{ token: string }>('POST', '/v1/auth/login', { email, password });
      saveConfig(DEFAULT_CONFIG_PATH, { ...existing, serverUrl, token });
      process.stdout.write(`logged in. config: ${DEFAULT_CONFIG_PATH}\n`);
    });

  program.command('use <slug>')
    .description('set default project slug for this config')
    .action((slug: string) => {
      const cfg = loadConfig() ?? { serverUrl: '' };
      saveConfig(DEFAULT_CONFIG_PATH, { ...cfg, defaultProject: slug });
      process.stdout.write(`default project: ${slug}\n`);
    });
}
