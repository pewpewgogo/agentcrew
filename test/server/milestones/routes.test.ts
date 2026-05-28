import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('milestone routes', () => {
  it('create, list, patch, delete', async () => {
    const tok = await asUser(app, 'm@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'mp', name: 'mp' } });

    const c = await app.inject({
      method: 'POST', url: '/v1/projects/mp/milestones', headers: H(tok),
      payload: { title: 'M1', goal: 'ship' },
    });
    expect(c.statusCode).toBe(201);
    const id = JSON.parse(c.payload).id as string;

    const list = await app.inject({ method: 'GET', url: '/v1/projects/mp/milestones', headers: H(tok) });
    expect(JSON.parse(list.payload)).toHaveLength(1);

    const u = await app.inject({
      method: 'PATCH', url: `/v1/milestones/${id}`, headers: H(tok),
      payload: { status: 'done' },
    });
    expect(JSON.parse(u.payload).status).toBe('done');

    const d = await app.inject({ method: 'DELETE', url: `/v1/milestones/${id}`, headers: H(tok) });
    expect(d.statusCode).toBe(204);
  });

  it('rejects access to a milestone in a project the user is not a member of', async () => {
    const a = await asUser(app, 'a@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(a), payload: { slug: 'priv', name: 'priv' } });
    const c = await app.inject({
      method: 'POST', url: '/v1/projects/priv/milestones', headers: H(a),
      payload: { title: 'X' },
    });
    const id = JSON.parse(c.payload).id as string;

    const b = await asUser(app, 'b@t.co');
    const denied = await app.inject({ method: 'PATCH', url: `/v1/milestones/${id}`, headers: H(b), payload: { title: 'hax' } });
    expect(denied.statusCode).toBe(404);
  });
});
