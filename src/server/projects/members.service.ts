import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Member, Role } from '../../shared/types.js';

export class MemberService {
  constructor(private readonly pool: Pool) {}

  private async requireOwner(projectId: string, userId: string): Promise<void> {
    const r = await this.pool.query<{ role: Role }>(
      `select role from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
    if (!r.rows[0]) throw new AppError('not_found', 'project not found', 404);
    if (r.rows[0].role !== 'owner') throw new AppError('forbidden', 'owner role required', 403);
  }

  async list(projectId: string, byUser: string): Promise<Member[]> {
    const r = await this.pool.query<{ role: Role }>(
      `select role from project_members where project_id = $1 and user_id = $2`,
      [projectId, byUser],
    );
    if (!r.rows[0]) throw new AppError('not_found', 'project not found', 404);
    const ms = await this.pool.query<{ user_id: string; email: string; role: Role }>(
      `select m.user_id, u.email, m.role from project_members m
       join users u on u.id = m.user_id
       where m.project_id = $1 order by m.role, u.email`,
      [projectId],
    );
    return ms.rows.map((x) => ({ userId: x.user_id, email: x.email, role: x.role }));
  }

  async add(projectId: string, byUser: string, input: { email: string; role: Role }): Promise<Member> {
    await this.requireOwner(projectId, byUser);
    const u = await this.pool.query<{ id: string }>(`select id from users where email = $1`, [input.email]);
    if (!u.rows[0]) throw new AppError('not_found', 'user not found', 404);
    await this.pool.query(
      `insert into project_members (project_id, user_id, role) values ($1,$2,$3)
       on conflict (project_id, user_id) do update set role = excluded.role`,
      [projectId, u.rows[0].id, input.role],
    );
    return { userId: u.rows[0].id, email: input.email, role: input.role };
  }

  async remove(projectId: string, byUser: string, userId: string): Promise<void> {
    await this.requireOwner(projectId, byUser);
    if (byUser === userId) throw new AppError('conflict', 'cannot remove yourself', 409);
    await this.pool.query(
      `delete from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
  }
}
