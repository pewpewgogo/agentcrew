import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli api against real server', () => {
  it('signup, login via API, mint key', async () => {
    const api = new Api({ serverUrl: baseUrl });
    await api.request('POST', '/v1/auth/signup', { email: 'cli@t.co', password: 'password123' });
    const { token } = await api.request<{ token: string }>('POST', '/v1/auth/login', { email: 'cli@t.co', password: 'password123' });
    expect(token).toMatch(/^cs_s_/);

    const authed = new Api({ serverUrl: baseUrl, token });
    const k = await authed.request<{ id: string; raw: string }>('POST', '/v1/auth/keys', { name: 'laptop' });
    expect(k.raw).toMatch(/^cs_k_/);
  });
});
