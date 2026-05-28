import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig, type Config } from '../config.js';
import { jsonOut, table } from '../output.js';

// Accepts an ISO datetime or a duration like "30s", "5m", "2h", "7d".
// Returns an ISO datetime string. For durations, returns now - duration.
export function parseSince(input: string): string {
  const m = input.match(/^(\d+)([smhd])$/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!;
    const ms = unit === 's' ? n * 1000
             : unit === 'm' ? n * 60_000
             : unit === 'h' ? n * 3_600_000
             :                n * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
  return input;
}

function resolveSlug(opts: { project?: string }, cfg: Config): string | undefined {
  return opts.project ?? cfg.defaultProject;
}

export function registerContext(program: Command): void {
  const ctx = program.command('ctx').description('append-only context log');

  ctx.command('add <task-id> <note>')
    .description('append a note to a task in the context log')
    .option('--json', 'json output')
    .action(async (taskId: string, note: string, opts) => {
      const api = new Api(requireConfig());
      const e = await api.request<any>('POST', '/v1/context', {
        target_type: 'task', target_id: taskId, note,
      });
      if (opts.json) jsonOut(e);
      else process.stdout.write(`logged: ${e.id}\n`);
    });

  ctx.command('log')
    .description('query the context log')
    .option('-p, --project <slug>', 'project slug (default: current default project)')
    .option('--since <iso-or-duration>', 'lower bound, e.g. 2026-01-01T00:00:00Z or 7d')
    .option('--limit <n>', 'max rows', '100')
    .option('--json', 'json output')
    .action(async (opts) => {
      const cfg = requireConfig();
      const api = new Api(cfg);
      const slug = resolveSlug(opts, cfg);
      const qs = new URLSearchParams();
      if (slug) qs.set('project', slug);
      if (opts.since) qs.set('since', parseSince(opts.since));
      if (opts.limit) qs.set('limit', String(opts.limit));
      const q = qs.toString();
      const list = await api.request<any[]>('GET', `/v1/context${q ? `?${q}` : ''}`);
      if (opts.json) jsonOut(list);
      else table(list, ['created_at', 'target_type', 'target_id', 'author_kind', 'note']);
    });

}
