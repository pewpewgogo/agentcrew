import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig } from '../config.js';
import { jsonOut, table } from '../output.js';

export function registerKeys(program: Command): void {
  const keys = program.command('keys').description('manage api keys');

  keys.command('new <name>')
    .description('mint a new api key (raw shown once)')
    .option('--json', 'json output')
    .action(async (name: string, opts) => {
      const api = new Api(requireConfig());
      const k = await api.request<{ id: string; raw: string }>('POST', '/v1/auth/keys', { name });
      if (opts.json) jsonOut(k);
      else process.stdout.write(`id:  ${k.id}\nraw: ${k.raw}\n(save this — it will not be shown again)\n`);
    });

  keys.command('ls')
    .description('list api keys')
    .option('--json', 'json output')
    .action(async (opts) => {
      const api = new Api(requireConfig());
      const ks = await api.request<{ id: string; name: string; createdAt: string }[]>('GET', '/v1/auth/keys');
      if (opts.json) jsonOut(ks);
      else table(ks, ['id', 'name', 'createdAt']);
    });

  keys.command('rm <id>')
    .description('revoke a key')
    .action(async (id: string) => {
      const api = new Api(requireConfig());
      await api.request('DELETE', `/v1/auth/keys/${id}`);
      process.stdout.write('revoked\n');
    });
}
