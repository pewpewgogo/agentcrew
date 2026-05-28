import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TaskService } from '../../../src/server/tasks/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: TaskService; let uid: string; let pid: string;
beforeAll(async () => {
  svc = new TaskService(pool);
  uid = await makeUser(pool);
  pid = await makeProject(pool, uid);
});

describe('TaskService', () => {
  it('create returns task with defaults', async () => {
    const t = await svc.create(pid, uid, { title: 'T1' });
    expect(t.status).toBe('todo');
    expect(t.priority).toBe('med');
    expect(t.assigneeUserId).toBeNull();
  });

  it('list filters by status and mine', async () => {
    const t = await svc.create(pid, uid, { title: 'T2' });
    await svc.update(t.id, { assignee_user_id: uid, status: 'doing' });
    const mine = await svc.listForProject(pid, { mine: true, userId: uid });
    expect(mine.find((x) => x.id === t.id)).toBeTruthy();
    const doing = await svc.listForProject(pid, { status: 'doing' });
    expect(doing.find((x) => x.id === t.id)).toBeTruthy();
    const blocked = await svc.listForProject(pid, { status: 'blocked' });
    expect(blocked.find((x) => x.id === t.id)).toBeFalsy();
  });

  it('claim sets assignee to caller', async () => {
    const t = await svc.create(pid, uid, { title: 'T3' });
    const c = await svc.claim(t.id, uid);
    expect(c.assigneeUserId).toBe(uid);
  });

  it('update touches updated_at', async () => {
    const t = await svc.create(pid, uid, { title: 'T4' });
    const before = t.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const u = await svc.update(t.id, { title: 'T4b' });
    expect(u.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('get throws not_found for unknown id', async () => {
    await expect(svc.get('00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ code: 'not_found' });
  });
});
