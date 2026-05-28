import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from './helpers/db.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));

const expectTable = async (name: string) => {
  const r = await pool.query(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
    [name],
  );
  expect(r.rowCount, `table ${name} missing`).toBe(1);
};

describe('migrations', () => {
  it('creates all six core tables', async () => {
    for (const t of ['users','api_keys','projects','project_members','project_kb','milestones','tasks','context_log']) {
      await expectTable(t);
    }
  });
  it('users.email is unique', async () => {
    await pool.query(`insert into users (id, email) values (gen_random_uuid(), 'a@b.c')`);
    await expect(
      pool.query(`insert into users (id, email) values (gen_random_uuid(), 'a@b.c')`),
    ).rejects.toThrow();
  });
});
