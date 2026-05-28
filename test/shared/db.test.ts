import { describe, it, expect, afterAll } from 'vitest';
import { createPool } from '../../src/shared/db.js';
import { TEST_DB_URL } from '../helpers/db.js';

const pool = createPool(TEST_DB_URL);
afterAll(() => pool.end());

describe('createPool', () => {
  it('connects and runs a query', async () => {
    const r = await pool.query<{ ok: number }>('select 1 as ok');
    expect(r.rows[0]?.ok).toBe(1);
  });
});
