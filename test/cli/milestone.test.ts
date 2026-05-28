import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli milestone', () => {
  it('new → ls → set status → rm lifecycle', async () => {
    const token = await asUser(app, 'ms@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    await api.request('POST', '/v1/projects', { slug: 'ms-p', name: 'ms p' });

    const m = await api.request<any>('POST', '/v1/projects/ms-p/milestones', {
      title: 'M1', goal: 'ship', due_date: '2026-12-31',
    });
    expect(m.id).toBeDefined();
    expect(m.status).toBe('open');

    const list = await api.request<any[]>('GET', '/v1/projects/ms-p/milestones');
    expect(list.length).toBe(1);

    const updated = await api.request<any>('PATCH', `/v1/milestones/${m.id}`, { status: 'done' });
    expect(updated.status).toBe('done');

    await api.request('DELETE', `/v1/milestones/${m.id}`);
    const list2 = await api.request<any[]>('GET', '/v1/projects/ms-p/milestones');
    expect(list2.length).toBe(0);
  });
});
