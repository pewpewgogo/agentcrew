import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TEST_DB_URL =
  process.env.TEST_DB_URL ?? 'postgres://contextsync:contextsync@localhost:54329/contextsync_test';

export async function freshSchema(): Promise<Pool> {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  await pool.query('drop schema public cascade; create schema public;');
  const dir = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), 'utf8');
    await pool.query(sql);
  }
  return pool;
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
}
