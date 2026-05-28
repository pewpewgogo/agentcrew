import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig } from '../config.js';
import { jsonOut, table, die } from '../output.js';

function resolveSlug(arg: string | undefined, opts: { project?: string }, cfg: { defaultProject?: string }): string {
  const slug = arg ?? opts.project ?? cfg.defaultProject;
  if (!slug) die('no project specified');
  return slug!;
}

export function registerProject(program: Command): void {
  const project = program.command('project').description('manage projects');

  project.command('ls')
    .description('list projects you are a member of')
    .option('--json', 'json output')
    .action(async (opts) => {
      const api = new Api(requireConfig());
      const list = await api.request<any[]>('GET', '/v1/projects');
      if (opts.json) jsonOut(list);
      else table(list, ['slug', 'name', 'role', 'createdAt']);
    });

  project.command('show [slug]')
    .description('show a project, its kb, and members')
    .option('-p, --project <slug>', 'project slug')
    .option('--json', 'json output')
    .action(async (slug: string | undefined, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(slug, opts, cfg);
      const api = new Api(cfg);
      const p = await api.request<any>('GET', `/v1/projects/${s}`);
      if (opts.json) { jsonOut(p); return; }
      process.stdout.write(`slug:    ${p.slug}\nname:    ${p.name}\nrole:    ${p.role}\n`);
      if (p.description) process.stdout.write(`desc:    ${p.description}\n`);
      process.stdout.write(`\nmembers:\n`);
      table(p.members, ['email', 'role', 'userId']);
      process.stdout.write(`\nkb:\n`);
      jsonOut(p.kb);
    });

  project.command('new <slug>')
    .description('create a new project')
    .option('-n, --name <name>', 'display name (defaults to slug)')
    .option('-d, --description <desc>', 'description')
    .option('--json', 'json output')
    .action(async (slug: string, opts) => {
      const api = new Api(requireConfig());
      const body: Record<string, unknown> = { slug, name: opts.name ?? slug };
      if (opts.description) body.description = opts.description;
      const p = await api.request<any>('POST', '/v1/projects', body);
      if (opts.json) jsonOut(p);
      else process.stdout.write(`created: ${p.slug}\n`);
    });
}
