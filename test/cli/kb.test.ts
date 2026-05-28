import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli kb', () => {
  it('show, add repo/url/tech, then PATCH writes them back', async () => {
    const token = await asUser(app, 'kb@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    await api.request('POST', '/v1/projects', { slug: 'kb-p', name: 'kb p' });

    const kb0 = await api.request<any>('GET', '/v1/projects/kb-p/kb');
    expect(kb0.repos).toEqual([]);

    const repos = [...(kb0.repos ?? []), { label: 'main', url: 'https://example.com/r' }];
    const after = await api.request<any>('PATCH', '/v1/projects/kb-p/kb', { repos });
    expect(after.repos).toEqual([{ label: 'main', url: 'https://example.com/r' }]);
  });

  it('note appends to kb.notes AND creates a context entry', async () => {
    const token = await asUser(app, 'kbn@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    const proj = await api.request<any>('POST', '/v1/projects', { slug: 'kbn-p', name: 'kbn p' });

    // simulate `cs kb note`: PATCH kb + POST context
    const text = 'first note';
    const cur = await api.request<any>('GET', '/v1/projects/kbn-p/kb');
    const notes = (cur.notes ? cur.notes + '\n' : '') + text;
    await api.request('PATCH', '/v1/projects/kbn-p/kb', { notes });
    await api.request('POST', '/v1/context', { target_type: 'project', target_id: proj.id, note: text });

    const kb = await api.request<any>('GET', '/v1/projects/kbn-p/kb');
    expect(kb.notes).toBe('first note');

    const log = await api.request<any[]>('GET', '/v1/context?project=kbn-p');
    expect(log.length).toBe(1);
    expect(log[0]!.note).toBe('first note');
    expect(log[0]!.target_type).toBe('project');
  });
});
