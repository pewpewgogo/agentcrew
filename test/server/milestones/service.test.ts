import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MilestoneService } from '../../../src/server/milestones/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: MilestoneService; let uid: string; let pid: string;
beforeAll(async () => {
  svc = new MilestoneService(pool);
  uid = await makeUser(pool);
  pid = await makeProject(pool, uid);
});

describe('MilestoneService', () => {
  it('create returns milestone, list returns it', async () => {
    const m = await svc.create(pid, { title: 'M1', goal: 'ship' });
    expect(m.title).toBe('M1');
    const list = await svc.listForProject(pid);
    expect(list).toHaveLength(1);
  });

  it('update changes status', async () => {
    const m = await svc.create(pid, { title: 'M2' });
    const u = await svc.update(m.id, { status: 'done' });
    expect(u.status).toBe('done');
  });

  it('list orders by order_index then created_at', async () => {
    const a = await svc.create(pid, { title: 'A' });
    const b = await svc.create(pid, { title: 'B' });
    await svc.update(a.id, { order_index: 5 });
    await svc.update(b.id, { order_index: 1 });
    const list = await svc.listForProject(pid);
    expect(list.findIndex((m) => m.id === b.id)).toBeLessThan(list.findIndex((m) => m.id === a.id));
  });

  it('delete removes the milestone', async () => {
    const m = await svc.create(pid, { title: 'D' });
    await svc.delete(m.id);
    const list = await svc.listForProject(pid);
    expect(list.find((x) => x.id === m.id)).toBeUndefined();
  });
});
