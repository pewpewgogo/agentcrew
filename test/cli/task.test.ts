import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli task', () => {
  it('new → ls → show → claim → set status=done → rm', async () => {
    const token = await asUser(app, 'tk@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    await api.request('POST', '/v1/projects', { slug: 'tk-p', name: 'tk p' });

    const t = await api.request<any>('POST', '/v1/projects/tk-p/tasks', {
      title: 'T1', goal: 'do it', priority: 'high',
    });
    expect(t.status).toBe('todo');

    const list = await api.request<any[]>('GET', '/v1/projects/tk-p/tasks');
    expect(list.length).toBe(1);

    const show = await api.request<any>('GET', `/v1/tasks/${t.id}`);
    expect(show.id).toBe(t.id);
    expect(Array.isArray(show.context)).toBe(true);

    // resolve self user id via members list for assignee
    const proj = await api.request<any>('GET', '/v1/projects/tk-p');
    const me = proj.members.find((m: any) => m.email === 'tk@t.co')!;
    expect(me).toBeDefined();

    const claimed = await api.request<any>('PATCH', `/v1/tasks/${t.id}`, { assignee_user_id: me.userId });
    expect(claimed.assigneeUserId).toBe(me.userId);

    const done = await api.request<any>('PATCH', `/v1/tasks/${t.id}`, { status: 'done' });
    expect(done.status).toBe('done');

    await api.request('DELETE', `/v1/tasks/${t.id}`);
    const list2 = await api.request<any[]>('GET', '/v1/projects/tk-p/tasks');
    expect(list2.length).toBe(0);
  });
});
