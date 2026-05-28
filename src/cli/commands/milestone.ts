import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig, type Config } from '../config.js';
import { jsonOut, table, die } from '../output.js';

function resolveSlug(arg: string | undefined, opts: { project?: string }, cfg: Config): string {
  const slug = arg ?? opts.project ?? cfg.defaultProject;
  if (!slug) die('no project specified');
  return slug!;
}

export function registerMilestone(program: Command): void {
  const ms = program.command('ms').description('manage milestones');

  ms.command('ls [slug]')
    .description('list milestones for a project')
    .option('-p, --project <slug>', 'project slug')
    .option('--json', 'json output')
    .action(async (slug: string | undefined, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(slug, opts, cfg);
      const api = new Api(cfg);
      const list = await api.request<any[]>('GET', `/v1/projects/${s}/milestones`);
      if (opts.json) jsonOut(list);
      else table(list, ['id', 'title', 'status', 'dueDate']);
    });

  ms.command('new <title>')
    .description('create a new milestone')
    .option('-p, --project <slug>', 'project slug')
    .option('-g, --goal <goal>', 'milestone goal')
    .option('--due <yyyy-mm-dd>', 'due date')
    .option('--json', 'json output')
    .action(async (title: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const body: Record<string, unknown> = { title };
      if (opts.goal) body.goal = opts.goal;
      if (opts.due) body.due_date = opts.due;
      const m = await api.request<any>('POST', `/v1/projects/${s}/milestones`, body);
      if (opts.json) jsonOut(m);
      else process.stdout.write(`created milestone ${m.id}: ${m.title}\n`);
    });

  ms.command('set <id>')
    .description('update a milestone')
    .option('--title <title>', 'new title')
    .option('--goal <goal>', 'new goal')
    .option('--status <status>', 'open|done')
    .option('--due <yyyy-mm-dd>', 'due date')
    .option('--json', 'json output')
    .action(async (id: string, opts) => {
      const api = new Api(requireConfig());
      const body: Record<string, unknown> = {};
      if (opts.title !== undefined)  body.title = opts.title;
      if (opts.goal !== undefined)   body.goal = opts.goal;
      if (opts.status !== undefined) body.status = opts.status;
      if (opts.due !== undefined)    body.due_date = opts.due;
      const m = await api.request<any>('PATCH', `/v1/milestones/${id}`, body);
      if (opts.json) jsonOut(m);
      else process.stdout.write(`updated milestone ${m.id}\n`);
    });

  ms.command('rm <id>')
    .description('delete a milestone')
    .action(async (id: string) => {
      const api = new Api(requireConfig());
      await api.request('DELETE', `/v1/milestones/${id}`);
      process.stdout.write('deleted\n');
    });
}
