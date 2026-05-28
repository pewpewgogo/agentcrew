import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ContextService } from '../../../src/server/context/service.js';
import { TaskService } from '../../../src/server/tasks/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let ctx: ContextService; let tasks: TaskService;
let uid: string; let pid: string; let taskId: string;
beforeAll(async () => {
  ctx = new ContextService(pool); tasks = new TaskService(pool);
  uid = await makeUser(pool); pid = await makeProject(pool, uid);
  const t = await tasks.create(pid, uid, { title: 'T' });
  taskId = t.id;
});

describe('ContextService', () => {
  it('append on task derives project_id from task', async () => {
    const e = await ctx.append({
      authorUserId: uid, authorKind: 'agent',
      targetType: 'task', targetId: taskId, note: 'found a thing',
    });
    expect(e.projectId).toBe(pid);
    expect(e.authorKind).toBe('agent');
    expect(e.note).toBe('found a thing');
  });

  it('append on project requires target_id to be a project id', async () => {
    const e = await ctx.append({
      authorUserId: uid, authorKind: 'human',
      targetType: 'project', targetId: pid, note: 'project note',
    });
    expect(e.projectId).toBe(pid);
  });

  it('append on unknown task throws not_found', async () => {
    await expect(ctx.append({
      authorUserId: uid, authorKind: 'agent',
      targetType: 'task', targetId: '00000000-0000-0000-0000-000000000000', note: 'x',
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('query filters by target', async () => {
    await ctx.append({ authorUserId: uid, authorKind: 'agent', targetType: 'task', targetId: taskId, note: 'a' });
    const list = await ctx.query({ project: pid, targetType: 'task', targetId: taskId, limit: 100 });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((e) => e.targetId === taskId)).toBe(true);
  });

  it('query respects since', async () => {
    const cutoff = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await ctx.append({ authorUserId: uid, authorKind: 'human', targetType: 'task', targetId: taskId, note: 'after' });
    const list = await ctx.query({ project: pid, since: cutoff, limit: 100 });
    expect(list.find((e) => e.note === 'after')).toBeTruthy();
  });
});
