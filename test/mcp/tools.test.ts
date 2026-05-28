import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';

// The MCP HTTP transport is exposed at /mcp. We test the tool surface by exercising
// the same handlers the transport uses, exported as `mcpTools(services)`.
import { mcpTools } from '../../src/mcp/tools.js';
import { buildServices } from '../../src/server/app.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });

describe('mcp tools', () => {
  it('list_projects returns memberships for the calling user', async () => {
    const tok = await asUser(app, 'mcp@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: { authorization: `Bearer ${tok}` }, payload: { slug: 'mcpp', name: 'mcpp' } });
    const me = JSON.parse((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${tok}` } })).payload);

    const tools = mcpTools(buildServices(pool));
    const out = await tools.list_projects.handler({ userId: me.id, authorKind: 'agent' }, {});
    expect(out.find((p: any) => p.slug === 'mcpp')).toBeTruthy();
  });

  it('add_context stamps author_kind=agent', async () => {
    const tok = await asUser(app, 'mcp2@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: { authorization: `Bearer ${tok}` }, payload: { slug: 'mcpp2', name: 'mcpp2' } });
    const c = await app.inject({ method: 'POST', url: '/v1/projects/mcpp2/tasks', headers: { authorization: `Bearer ${tok}` }, payload: { title: 'T' } });
    const task = JSON.parse(c.payload);
    const me = JSON.parse((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${tok}` } })).payload);

    const tools = mcpTools(buildServices(pool));
    const e = await tools.add_context.handler(
      { userId: me.id, authorKind: 'agent' },
      { target_type: 'task', target_id: task.id, note: 'agent found a thing' },
    );
    expect(e.author_kind).toBe('agent');
  });
});
