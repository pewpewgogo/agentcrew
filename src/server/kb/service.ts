import type { Pool } from 'pg';
import type { Kb } from '../../shared/types.js';

const row = (r: any): Kb => ({
  repos: r.repos, urls: r.urls, techStack: r.tech_stack,
  notes: r.notes, updatedAt: r.updated_at,
});

type Patch = {
  repos?: { label: string; url: string }[];
  urls?: { label: string; url: string }[];
  tech_stack?: string[];
  notes?: string;
};

export class KbService {
  constructor(private readonly pool: Pool) {}

  async get(projectId: string): Promise<Kb> {
    const r = await this.pool.query(
      `select repos, urls, tech_stack, notes, updated_at from project_kb where project_id = $1`,
      [projectId],
    );
    return row(r.rows[0]);
  }

  async update(projectId: string, patch: Patch): Promise<Kb> {
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.repos !== undefined)      { vals.push(JSON.stringify(patch.repos));      sets.push(`repos = $${vals.length}::jsonb`); }
    if (patch.urls !== undefined)       { vals.push(JSON.stringify(patch.urls));       sets.push(`urls = $${vals.length}::jsonb`); }
    if (patch.tech_stack !== undefined) { vals.push(JSON.stringify(patch.tech_stack)); sets.push(`tech_stack = $${vals.length}::jsonb`); }
    if (patch.notes !== undefined)      { vals.push(patch.notes);                       sets.push(`notes = $${vals.length}`); }
    if (sets.length === 0) return this.get(projectId);
    sets.push(`updated_at = now()`);
    vals.push(projectId);
    const r = await this.pool.query(
      `update project_kb set ${sets.join(', ')} where project_id = $${vals.length}
       returning repos, urls, tech_stack, notes, updated_at`,
      vals,
    );
    return row(r.rows[0]);
  }
}
