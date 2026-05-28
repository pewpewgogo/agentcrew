import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Task, TaskStatus, TaskPriority } from '../../shared/types.js';

const row = (r: any): Task => ({
  id: r.id, projectId: r.project_id, milestoneId: r.milestone_id,
  title: r.title, description: r.description, goal: r.goal,
  status: r.status as TaskStatus, priority: r.priority as TaskPriority,
  assigneeUserId: r.assignee_user_id, createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

type ListFilter = {
  milestone?: string; status?: TaskStatus; assignee?: string;
  mine?: boolean; userId?: string;
};

export class TaskService {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, createdBy: string, input: {
    title: string; description?: string; goal?: string;
    milestone_id?: string; priority?: TaskPriority; assignee_user_id?: string;
  }): Promise<Task> {
    const r = await this.pool.query(
      `insert into tasks (project_id, milestone_id, title, description, goal, priority, assignee_user_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, project_id, milestone_id, title, description, goal,
                 status, priority, assignee_user_id, created_by, created_at, updated_at`,
      [projectId, input.milestone_id ?? null, input.title, input.description ?? null,
       input.goal ?? null, input.priority ?? 'med', input.assignee_user_id ?? null, createdBy],
    );
    return row(r.rows[0]);
  }

  async listForProject(projectId: string, filter: ListFilter = {}): Promise<Task[]> {
    const conds: string[] = [`project_id = $1`]; const vals: unknown[] = [projectId];
    if (filter.milestone) { vals.push(filter.milestone); conds.push(`milestone_id = $${vals.length}`); }
    if (filter.status)    { vals.push(filter.status);    conds.push(`status = $${vals.length}`); }
    if (filter.assignee)  { vals.push(filter.assignee);  conds.push(`assignee_user_id = $${vals.length}`); }
    if (filter.mine && filter.userId) { vals.push(filter.userId); conds.push(`assignee_user_id = $${vals.length}`); }
    const r = await this.pool.query(
      `select id, project_id, milestone_id, title, description, goal,
              status, priority, assignee_user_id, created_by, created_at, updated_at
       from tasks where ${conds.join(' and ')} order by created_at desc`,
      vals,
    );
    return r.rows.map(row);
  }

  async get(id: string): Promise<Task> {
    const r = await this.pool.query(
      `select id, project_id, milestone_id, title, description, goal,
              status, priority, assignee_user_id, created_by, created_at, updated_at
       from tasks where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'task not found', 404);
    return row(r.rows[0]);
  }

  async update(id: string, patch: Record<string, unknown>): Promise<Task> {
    const allowed = ['title','description','goal','milestone_id','status','priority','assignee_user_id'] as const;
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of allowed) {
      if (patch[k] !== undefined) { vals.push(patch[k]); sets.push(`${k} = $${vals.length}`); }
    }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await this.pool.query(
      `update tasks set ${sets.join(', ')} where id = $${vals.length}
       returning id, project_id, milestone_id, title, description, goal,
                 status, priority, assignee_user_id, created_by, created_at, updated_at`,
      vals,
    );
    if (!r.rows[0]) throw new AppError('not_found', 'task not found', 404);
    return row(r.rows[0]);
  }

  async claim(id: string, userId: string): Promise<Task> {
    return this.update(id, { assignee_user_id: userId });
  }

  async delete(id: string): Promise<void> {
    const r = await this.pool.query(`delete from tasks where id = $1`, [id]);
    if (r.rowCount === 0) throw new AppError('not_found', 'task not found', 404);
  }

  async projectIdOf(id: string): Promise<string> {
    const r = await this.pool.query<{ project_id: string }>(
      `select project_id from tasks where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'task not found', 404);
    return r.rows[0].project_id;
  }
}
