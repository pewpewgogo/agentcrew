import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig, type Config } from '../config.js';
import { jsonOut, table, die } from '../output.js';

function resolveSlug(arg: string | undefined, opts: { project?: string }, cfg: Config): string {
  const slug = arg ?? opts.project ?? cfg.defaultProject;
  if (!slug) die('no project specified');
  return slug!;
}

async function userIdForEmail(api: Api, slug: string, email: string): Promise<string> {
  const p = await api.request<any>('GET', `/v1/projects/${slug}`);
  const m = (p.members as { email: string; userId: string }[]).find((x) => x.email === email);
  if (!m) die(`no member with email ${email} on project ${slug}`);
  return m!.userId;
}

async function myUserId(api: Api, slug: string): Promise<string> {
  const me = await api.request<any>('GET', '/v1/auth/me');
  return userIdForEmail(api, slug, me.email);
}

export function registerTask(program: Command): void {
  const task = program.command('task').description('manage tasks');

  task.command('ls [slug]')
    .description('list tasks for a project')
    .option('--project <slug>', 'project slug')
    .option('--mine', 'only my tasks')
    .option('--status <status>', 'todo|doing|done|blocked')
    .option('--milestone <id>', 'filter by milestone id')
    .option('--json', 'json output')
    .action(async (slug: string | undefined, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(slug, opts, cfg);
      const api = new Api(cfg);
      const qs = new URLSearchParams();
      if (opts.mine) qs.set('mine', 'true');
      if (opts.status) qs.set('status', opts.status);
      if (opts.milestone) qs.set('milestone', opts.milestone);
      const q = qs.toString();
      const list = await api.request<any[]>('GET', `/v1/projects/${s}/tasks${q ? `?${q}` : ''}`);
      if (opts.json) jsonOut(list);
      else table(list, ['id', 'title', 'status', 'priority', 'assigneeUserId']);
    });

  task.command('new <title>')
    .description('create a new task')
    .option('--project <slug>', 'project slug')
    .option('-g, --goal <goal>', 'task goal')
    .option('-d, --description <desc>', 'task description')
    .option('-m, --milestone <id>', 'milestone id')
    .option('-p, --priority <priority>', 'low|med|high', 'med')
    .option('--assignee <email>', 'assignee email')
    .option('--json', 'json output')
    .action(async (title: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const body: Record<string, unknown> = { title, priority: opts.priority };
      if (opts.goal) body.goal = opts.goal;
      if (opts.description) body.description = opts.description;
      if (opts.milestone) body.milestone_id = opts.milestone;
      if (opts.assignee) body.assignee_user_id = await userIdForEmail(api, s, opts.assignee);
      const t = await api.request<any>('POST', `/v1/projects/${s}/tasks`, body);
      if (opts.json) jsonOut(t);
      else process.stdout.write(`created task ${t.id}: ${t.title}\n`);
    });

  task.command('show <id>')
    .description('show a task including context log')
    .option('--json', 'json output')
    .action(async (id: string, opts) => {
      const api = new Api(requireConfig());
      const t = await api.request<any>('GET', `/v1/tasks/${id}`);
      if (opts.json) { jsonOut(t); return; }
      process.stdout.write(`id:       ${t.id}\ntitle:    ${t.title}\nstatus:   ${t.status}\npriority: ${t.priority}\n`);
      if (t.goal) process.stdout.write(`goal:     ${t.goal}\n`);
      if (t.assigneeUserId) process.stdout.write(`assignee: ${t.assigneeUserId}\n`);
      if (t.description) process.stdout.write(`\n${t.description}\n`);
      if (Array.isArray(t.context) && t.context.length) {
        process.stdout.write(`\ncontext:\n`);
        for (const c of t.context) process.stdout.write(`  - ${c.createdAt}: ${c.note}\n`);
      }
    });

  task.command('claim <id>')
    .description('assign a task to yourself')
    .option('--project <slug>', 'project slug for resolving your user id')
    .option('--json', 'json output')
    .action(async (id: string, opts) => {
      const cfg = requireConfig();
      const api = new Api(cfg);
      const t = await api.request<any>('GET', `/v1/tasks/${id}`);
      // try to resolve slug from -p, then defaultProject, then look up project from task
      let slug: string | undefined = opts.project ?? cfg.defaultProject;
      if (!slug) {
        const projects = await api.request<any[]>('GET', '/v1/projects');
        const p = projects.find((x) => x.id === t.projectId);
        slug = p?.slug;
      }
      if (!slug) die('cannot resolve project slug to look up user id; pass --project');
      const uid = await myUserId(api, slug!);
      const updated = await api.request<any>('PATCH', `/v1/tasks/${id}`, { assignee_user_id: uid });
      if (opts.json) jsonOut(updated);
      else process.stdout.write(`claimed task ${updated.id}\n`);
    });

  task.command('set <id>')
    .description('update a task')
    .option('--project <slug>', 'project slug for resolving --assignee email')
    .option('--title <title>', 'new title')
    .option('--goal <goal>', 'new goal')
    .option('--description <desc>', 'new description')
    .option('--status <status>', 'todo|doing|done|blocked')
    .option('-p, --priority <priority>', 'low|med|high')
    .option('--assignee <email>', 'assignee email')
    .option('--json', 'json output')
    .action(async (id: string, opts) => {
      const cfg = requireConfig();
      const api = new Api(cfg);
      const body: Record<string, unknown> = {};
      if (opts.title !== undefined)       body.title = opts.title;
      if (opts.goal !== undefined)        body.goal = opts.goal;
      if (opts.description !== undefined) body.description = opts.description;
      if (opts.status !== undefined)      body.status = opts.status;
      if (opts.priority !== undefined)    body.priority = opts.priority;
      if (opts.assignee !== undefined) {
        let slug: string | undefined = opts.project ?? cfg.defaultProject;
        if (!slug) {
          const t = await api.request<any>('GET', `/v1/tasks/${id}`);
          const projects = await api.request<any[]>('GET', '/v1/projects');
          slug = projects.find((x) => x.id === t.projectId)?.slug;
        }
        if (!slug) die('cannot resolve project slug for --assignee; pass --project');
        body.assignee_user_id = await userIdForEmail(api, slug!, opts.assignee);
      }
      const t = await api.request<any>('PATCH', `/v1/tasks/${id}`, body);
      if (opts.json) jsonOut(t);
      else process.stdout.write(`updated task ${t.id}\n`);
    });

  task.command('rm <id>')
    .description('delete a task')
    .action(async (id: string) => {
      const api = new Api(requireConfig());
      await api.request('DELETE', `/v1/tasks/${id}`);
      process.stdout.write('deleted\n');
    });
}
