import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('kb routes', () => {
  it('PATCH replaces repos and GET reflects it', async () => {
    const tok = await asUser(app, 'k@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'kb1', name: 'k' } });
    const u = await app.inject({
      method: 'PATCH', url: '/v1/projects/kb1/kb', headers: H(tok),
      payload: { repos: [{ label: 'main', url: 'https://github.com/x/y' }] },
    });
    expect(u.statusCode).toBe(200);
    const g = await app.inject({ method: 'GET', url: '/v1/projects/kb1/kb', headers: H(tok) });
    expect(JSON.parse(g.payload).repos[0].label).toBe('main');
  });
});
