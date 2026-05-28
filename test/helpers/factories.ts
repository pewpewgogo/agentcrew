import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export async function makeUser(pool: Pool, email = `u-${randomUUID()}@t.co`): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into users (id, email, name) values (gen_random_uuid(), $1, 'Test') returning id`,
    [email],
  );
  return r.rows[0]!.id;
}

export async function makeProject(pool: Pool, ownerId: string, slug = `p-${randomUUID().slice(0,8)}`): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into projects (id, slug, name, created_by) values (gen_random_uuid(), $1, $1, $2) returning id`,
    [slug, ownerId],
  );
  await pool.query(
    `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
    [r.rows[0]!.id, ownerId],
  );
  await pool.query(`insert into project_kb (project_id) values ($1)`, [r.rows[0]!.id]);
  return r.rows[0]!.id;
}
