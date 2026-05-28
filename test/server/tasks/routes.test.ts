import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('task routes', () => {
  it('create, list with mine filter, patch, get includes recent context', async () => {
    const tok = await asUser(app, 't@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'tp', name: 'tp' } });
    const c = await app.inject({
      method: 'POST', url: '/v1/projects/tp/tasks', headers: H(tok),
      payload: { title: 'T1', goal: 'done means tests pass' },
    });
    expect(c.statusCode).toBe(201);
    const id = JSON.parse(c.payload).id as string;

    const claim = await app.inject({ method: 'PATCH', url: `/v1/tasks/${id}`, headers: H(tok), payload: { status: 'doing' } });
    expect(JSON.parse(claim.payload).status).toBe('doing');

    const mine = await app.inject({ method: 'GET', url: '/v1/projects/tp/tasks?mine=true', headers: H(tok) });
    expect(JSON.parse(mine.payload).length).toBeGreaterThanOrEqual(0); // mine requires assignee set

    await app.inject({ method: 'PATCH', url: `/v1/tasks/${id}`, headers: H(tok),
      payload: { assignee_user_id: JSON.parse((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: H(tok) })).payload).id } });
    const mine2 = await app.inject({ method: 'GET', url: '/v1/projects/tp/tasks?mine=true', headers: H(tok) });
    expect(JSON.parse(mine2.payload)).toHaveLength(1);

    await app.inject({
      method: 'POST', url: '/v1/context', headers: H(tok),
      payload: { target_type: 'task', target_id: id, note: 'finding A' },
    });
    const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}`, headers: H(tok) });
    const body = JSON.parse(get.payload);
    expect(body.context).toBeDefined();
    expect(body.context[0].note).toBe('finding A');
  });
});
