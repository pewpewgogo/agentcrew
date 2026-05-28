import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli project', () => {
  it('project new → ls → show contains kb and members', async () => {
    const token = await asUser(app, 'p@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    await api.request('POST', '/v1/projects', { slug: 'cli-p', name: 'cli p' });
    const list = await api.request<any[]>('GET', '/v1/projects');
    expect(list.find((p) => p.slug === 'cli-p')).toBeTruthy();
    const show = await api.request<any>('GET', '/v1/projects/cli-p');
    expect(show.kb).toBeDefined();
    expect(show.members.find((m: any) => m.role === 'owner')).toBeTruthy();
  });

  it('member add by email then rm by email-resolved user id', async () => {
    const ownerToken = await asUser(app, 'owner@t.co');
    const api = new Api({ serverUrl: baseUrl, token: ownerToken });
    await api.request('POST', '/v1/projects', { slug: 'mem-p', name: 'mem p' });
    // pre-create the user to add
    await new Api({ serverUrl: baseUrl }).request('POST', '/v1/auth/signup', { email: 'bob@t.co', password: 'password123' });
    const added = await api.request<any>('POST', '/v1/projects/mem-p/members', { email: 'bob@t.co', role: 'member' });
    expect(added.email).toBe('bob@t.co');

    const show = await api.request<any>('GET', '/v1/projects/mem-p');
    const bob = show.members.find((m: any) => m.email === 'bob@t.co');
    expect(bob).toBeDefined();
    expect(bob.userId).toBeDefined();

    await api.request('DELETE', `/v1/projects/mem-p/members/${bob.userId}`);
    const show2 = await api.request<any>('GET', '/v1/projects/mem-p');
    expect(show2.members.find((m: any) => m.email === 'bob@t.co')).toBeUndefined();
  });
});
