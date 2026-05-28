import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('context routes', () => {
  it('append on task; querying returns entry with author_kind=human for session token', async () => {
    const tok = await asUser(app, 'c@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'cp', name: 'cp' } });
    const c = await app.inject({ method: 'POST', url: '/v1/projects/cp/tasks', headers: H(tok), payload: { title: 'T' } });
    const taskId = JSON.parse(c.payload).id;

    const add = await app.inject({
      method: 'POST', url: '/v1/context', headers: H(tok),
      payload: { target_type: 'task', target_id: taskId, note: 'discovered repo' },
    });
    expect(add.statusCode).toBe(201);

    const q = await app.inject({
      method: 'GET', url: `/v1/context?target_type=task&target_id=${taskId}`, headers: H(tok),
    });
    const list = JSON.parse(q.payload);
    expect(list).toHaveLength(1);
    expect(list[0].author_kind).toBe('human');
    expect(list[0].note).toBe('discovered repo');
  });
});
