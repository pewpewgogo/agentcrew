import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });

describe('auth routes', () => {
  it('signup → login → /me returns user', async () => {
    const s = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'a@b.co', password: 'password123', name: 'A' } });
    expect(s.statusCode).toBe(201);
    const l = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@b.co', password: 'password123' } });
    expect(l.statusCode).toBe(200);
    const token = JSON.parse(l.payload).token as string;
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.payload).email).toBe('a@b.co');
  });

  it('POST /v1/auth/keys returns raw once; GET hides it', async () => {
    const l = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@b.co', password: 'password123' } });
    const token = JSON.parse(l.payload).token as string;
    const mint = await app.inject({
      method: 'POST', url: '/v1/auth/keys', headers: { authorization: `Bearer ${token}` },
      payload: { name: 'laptop' },
    });
    expect(mint.statusCode).toBe(201);
    const body = JSON.parse(mint.payload);
    expect(body.raw).toMatch(/^cs_k_/);
    expect(body.id).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/v1/auth/keys', headers: { authorization: `Bearer ${token}` } });
    const keys = JSON.parse(list.payload);
    expect(keys[0]).not.toHaveProperty('raw');
  });

  it('rejects missing token', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(r.statusCode).toBe(401);
  });
});
