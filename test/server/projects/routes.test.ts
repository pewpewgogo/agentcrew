import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });

const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('project routes', () => {
  it('CRUD round trip and member access boundary', async () => {
    const owner = await asUser(app, 'o@t.co');
    const create = await app.inject({
      method: 'POST', url: '/v1/projects', headers: H(owner),
      payload: { slug: 'acme', name: 'Acme' },
    });
    expect(create.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/v1/projects', headers: H(owner) });
    expect(JSON.parse(list.payload).map((p: any) => p.slug)).toContain('acme');

    const stranger = await asUser(app, 's@t.co');
    const denied = await app.inject({ method: 'GET', url: '/v1/projects/acme', headers: H(stranger) });
    expect(denied.statusCode).toBe(404);
  });

  it('owner adds and removes a member; non-owner cannot', async () => {
    const owner = await asUser(app, 'o2@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(owner), payload: { slug: 'mteam', name: 'm' } });
    await asUser(app, 'm@t.co');

    const add = await app.inject({
      method: 'POST', url: '/v1/projects/mteam/members', headers: H(owner),
      payload: { email: 'm@t.co', role: 'member' },
    });
    expect(add.statusCode).toBe(201);

    const member = await asUser(app, 'm@t.co'); // re-login → fresh token
    const cannot = await app.inject({
      method: 'POST', url: '/v1/projects/mteam/members', headers: H(member),
      payload: { email: 'm@t.co', role: 'owner' },
    });
    expect(cannot.statusCode).toBe(403);
  });
});
