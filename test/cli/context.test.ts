import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';
import { parseSince } from '../../src/cli/commands/context.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('parseSince', () => {
  it('parses durations s/m/h/d into ISO strings in the past', () => {
    const now = Date.now();
    const iso = parseSince('7d');
    const t = Date.parse(iso);
    const diff = now - t;
    expect(diff).toBeGreaterThan(7 * 86400000 - 5000);
    expect(diff).toBeLessThan(7 * 86400000 + 5000);
  });

  it('passes through an ISO datetime', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    expect(parseSince(iso)).toBe(iso);
  });

  it('supports s/m/h units', () => {
    expect(typeof parseSince('30s')).toBe('string');
    expect(typeof parseSince('5m')).toBe('string');
    expect(typeof parseSince('2h')).toBe('string');
  });
});

describe('cli context', () => {
  it('add then log --since 1h returns the entry', async () => {
    const token = await asUser(app, 'ctx@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    await api.request('POST', '/v1/projects', { slug: 'ctx-p', name: 'ctx p' });
    const t = await api.request<any>('POST', '/v1/projects/ctx-p/tasks', { title: 'T' });

    await api.request('POST', '/v1/context', { target_type: 'task', target_id: t.id, note: 'hello' });

    const since = parseSince('1h');
    const log = await api.request<any[]>('GET', `/v1/context?project=ctx-p&since=${encodeURIComponent(since)}`);
    expect(log.length).toBe(1);
    expect(log[0]!.note).toBe('hello');
    expect(log[0]!.target_type).toBe('task');
  });
});
