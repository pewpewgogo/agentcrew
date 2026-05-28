import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Milestone, MilestoneStatus } from '../../shared/types.js';

const row = (r: any): Milestone => ({
  id: r.id, projectId: r.project_id, title: r.title, goal: r.goal,
  status: r.status as MilestoneStatus, orderIndex: r.order_index,
  dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null,
  createdAt: r.created_at,
});

export class MilestoneService {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, input: { title: string; goal?: string; due_date?: string }): Promise<Milestone> {
    const r = await this.pool.query(
      `insert into milestones (project_id, title, goal, due_date) values ($1,$2,$3,$4)
       returning id, project_id, title, goal, status, order_index, due_date, created_at`,
      [projectId, input.title, input.goal ?? null, input.due_date ?? null],
    );
    return row(r.rows[0]);
  }

  async listForProject(projectId: string): Promise<Milestone[]> {
    const r = await this.pool.query(
      `select id, project_id, title, goal, status, order_index, due_date, created_at
       from milestones where project_id = $1 order by order_index asc, created_at asc`,
      [projectId],
    );
    return r.rows.map(row);
  }

  async get(id: string): Promise<Milestone> {
    const r = await this.pool.query(
      `select id, project_id, title, goal, status, order_index, due_date, created_at
       from milestones where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'milestone not found', 404);
    return row(r.rows[0]);
  }

  async update(id: string, patch: {
    title?: string; goal?: string | null; status?: MilestoneStatus;
    due_date?: string | null; order_index?: number;
  }): Promise<Milestone> {
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, dbKey] of [
      ['title','title'],['goal','goal'],['status','status'],
      ['due_date','due_date'],['order_index','order_index'],
    ] as const) {
      const v = (patch as any)[k];
      if (v !== undefined) { vals.push(v); sets.push(`${dbKey} = $${vals.length}`); }
    }
    if (sets.length === 0) return this.get(id);
    vals.push(id);
    const r = await this.pool.query(
      `update milestones set ${sets.join(', ')} where id = $${vals.length}
       returning id, project_id, title, goal, status, order_index, due_date, created_at`,
      vals,
    );
    if (!r.rows[0]) throw new AppError('not_found', 'milestone not found', 404);
    return row(r.rows[0]);
  }

  async delete(id: string): Promise<void> {
    const r = await this.pool.query(`delete from milestones where id = $1`, [id]);
    if (r.rowCount === 0) throw new AppError('not_found', 'milestone not found', 404);
  }

  async projectIdOf(id: string): Promise<string> {
    const r = await this.pool.query<{ project_id: string }>(
      `select project_id from milestones where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'milestone not found', 404);
    return r.rows[0].project_id;
  }
}
