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

export function registerMember(program: Command): void {
  const member = program.command('member').description('manage project members');

  member.command('ls [slug]')
    .description('list members of a project')
    .option('--project <slug>', 'project slug')
    .option('--json', 'json output')
    .action(async (slug: string | undefined, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(slug, opts, cfg);
      const api = new Api(cfg);
      const list = await api.request<any[]>('GET', `/v1/projects/${s}/members`);
      if (opts.json) jsonOut(list);
      else table(list, ['email', 'role', 'userId']);
    });

  member.command('add <email>')
    .description('add a member to a project by email')
    .option('--project <slug>', 'project slug')
    .option('-r, --role <role>', 'role: owner|member|viewer', 'member')
    .option('--json', 'json output')
    .action(async (email: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const m = await api.request<any>('POST', `/v1/projects/${s}/members`, { email, role: opts.role });
      if (opts.json) jsonOut(m);
      else process.stdout.write(`added ${m.email} as ${m.role}\n`);
    });

  member.command('rm <email>')
    .description('remove a member by email')
    .option('--project <slug>', 'project slug')
    .action(async (email: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const uid = await userIdForEmail(api, s, email);
      await api.request('DELETE', `/v1/projects/${s}/members/${uid}`);
      process.stdout.write(`removed ${email}\n`);
    });
}
