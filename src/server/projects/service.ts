import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Project, Role } from '../../shared/types.js';
import { withTx } from '../../shared/db.js';

const projectRow = (r: any): Project => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description,
  createdBy: r.created_by, createdAt: r.created_at,
});

export class ProjectService {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, input: { slug: string; name: string; description?: string }): Promise<Project> {
    try {
      return await withTx(this.pool, async (c) => {
        const r = await c.query(
          `insert into projects (slug, name, description, created_by) values ($1,$2,$3,$4)
           returning id, slug, name, description, created_by, created_at`,
          [input.slug, input.name, input.description ?? null, userId],
        );
        const p = projectRow(r.rows[0]);
        await c.query(
          `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
          [p.id, userId],
        );
        await c.query(`insert into project_kb (project_id) values ($1)`, [p.id]);
        return p;
      });
    } catch (e: any) {
      if (e.code === '23505') throw new AppError('conflict', 'slug already in use', 409);
      throw e;
    }
  }

  async listForUser(userId: string): Promise<(Project & { role: Role })[]> {
    const r = await this.pool.query(
      `select p.*, m.role from projects p
       join project_members m on m.project_id = p.id
       where m.user_id = $1 order by p.created_at desc`,
      [userId],
    );
    return r.rows.map((row) => ({ ...projectRow(row), role: row.role as Role }));
  }

  async getBySlugForUser(slug: string, userId: string): Promise<Project & { role: Role }> {
    const r = await this.pool.query(
      `select p.*, m.role from projects p
       join project_members m on m.project_id = p.id
       where p.slug = $1 and m.user_id = $2`,
      [slug, userId],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('not_found', 'project not found', 404);
    return { ...projectRow(row), role: row.role as Role };
  }

  async update(slug: string, userId: string, patch: { name?: string; description?: string | null }): Promise<Project> {
    const p = await this.getBySlugForUser(slug, userId);
    if (p.role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.name !== undefined) { vals.push(patch.name); sets.push(`name = $${vals.length}`); }
    if (patch.description !== undefined) { vals.push(patch.description); sets.push(`description = $${vals.length}`); }
    if (sets.length === 0) return p;
    vals.push(p.id);
    const r = await this.pool.query(
      `update projects set ${sets.join(', ')} where id = $${vals.length}
       returning id, slug, name, description, created_by, created_at`,
      vals,
    );
    return projectRow(r.rows[0]);
  }

  async roleFor(projectId: string, userId: string): Promise<Role | null> {
    const r = await this.pool.query<{ role: Role }>(
      `select role from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
    return r.rows[0]?.role ?? null;
  }

  async resolveSlug(slug: string, userId: string): Promise<{ id: string; role: Role }> {
    const p = await this.getBySlugForUser(slug, userId);
    return { id: p.id, role: p.role };
  }
}
