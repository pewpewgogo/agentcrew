import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig, type Config } from '../config.js';
import { jsonOut, die } from '../output.js';

interface KbLink { label: string; url: string }
interface Kb { repos: KbLink[]; urls: KbLink[]; techStack: string[]; notes: string | null; updatedAt: string }

function resolveSlug(arg: string | undefined, opts: { project?: string }, cfg: Config): string {
  const slug = arg ?? opts.project ?? cfg.defaultProject;
  if (!slug) die('no project specified');
  return slug!;
}

export function registerKb(program: Command): void {
  const kb = program.command('kb').description('manage project knowledge base');

  kb.command('show [slug]')
    .description('show the knowledge base')
    .option('-p, --project <slug>', 'project slug')
    .option('--json', 'json output')
    .action(async (slug: string | undefined, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(slug, opts, cfg);
      const api = new Api(cfg);
      const k = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      if (opts.json) { jsonOut(k); return; }
      process.stdout.write(`repos:\n`);
      for (const r of k.repos ?? []) process.stdout.write(`  - ${r.label}: ${r.url}\n`);
      process.stdout.write(`urls:\n`);
      for (const r of k.urls ?? []) process.stdout.write(`  - ${r.label}: ${r.url}\n`);
      process.stdout.write(`tech_stack: ${(k.techStack ?? []).join(', ')}\n`);
      if (k.notes) process.stdout.write(`\nnotes:\n${k.notes}\n`);
    });

  const add = kb.command('add').description('add an item to kb');
  const rm = kb.command('rm').description('remove an item from kb');

  add.command('repo <label> <url>')
    .option('-p, --project <slug>', 'project slug')
    .action(async (label: string, url: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const repos = [...(cur.repos ?? []).filter((r) => r.label !== label), { label, url }];
      await api.request('PATCH', `/v1/projects/${s}/kb`, { repos });
      process.stdout.write(`added repo ${label}\n`);
    });

  rm.command('repo <label>')
    .option('-p, --project <slug>', 'project slug')
    .action(async (label: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const repos = (cur.repos ?? []).filter((r) => r.label !== label);
      await api.request('PATCH', `/v1/projects/${s}/kb`, { repos });
      process.stdout.write(`removed repo ${label}\n`);
    });

  add.command('url <label> <url>')
    .option('-p, --project <slug>', 'project slug')
    .action(async (label: string, url: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const urls = [...(cur.urls ?? []).filter((r) => r.label !== label), { label, url }];
      await api.request('PATCH', `/v1/projects/${s}/kb`, { urls });
      process.stdout.write(`added url ${label}\n`);
    });

  rm.command('url <label>')
    .option('-p, --project <slug>', 'project slug')
    .action(async (label: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const urls = (cur.urls ?? []).filter((r) => r.label !== label);
      await api.request('PATCH', `/v1/projects/${s}/kb`, { urls });
      process.stdout.write(`removed url ${label}\n`);
    });

  add.command('tech <name>')
    .option('-p, --project <slug>', 'project slug')
    .action(async (name: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const techStack = Array.from(new Set([...(cur.techStack ?? []), name]));
      await api.request('PATCH', `/v1/projects/${s}/kb`, { tech_stack: techStack });
      process.stdout.write(`added tech ${name}\n`);
    });

  rm.command('tech <name>')
    .option('-p, --project <slug>', 'project slug')
    .action(async (name: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const techStack = (cur.techStack ?? []).filter((t) => t !== name);
      await api.request('PATCH', `/v1/projects/${s}/kb`, { tech_stack: techStack });
      process.stdout.write(`removed tech ${name}\n`);
    });

  kb.command('note <text>')
    .description('append a note to kb and the project context log')
    .option('-p, --project <slug>', 'project slug')
    .action(async (text: string, opts) => {
      const cfg = requireConfig();
      const s = resolveSlug(undefined, opts, cfg);
      const api = new Api(cfg);
      // resolve projectId via show
      const proj = await api.request<{ id: string }>('GET', `/v1/projects/${s}`);
      const cur = await api.request<Kb>('GET', `/v1/projects/${s}/kb`);
      const notes = (cur.notes ? cur.notes + '\n' : '') + text;
      await api.request('PATCH', `/v1/projects/${s}/kb`, { notes });
      await api.request('POST', '/v1/context', { target_type: 'project', target_id: proj.id, note: text });
      process.stdout.write('note recorded\n');
    });
}
