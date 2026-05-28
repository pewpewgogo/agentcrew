import { Pool, type PoolClient } from 'pg';

export type DB = Pool;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
