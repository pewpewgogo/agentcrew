import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemberService } from '../../../src/server/projects/members.service.js';
import { ProjectService } from '../../../src/server/projects/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let projects: ProjectService;
let members: MemberService;
let owner: string;
let projectId: string;
beforeAll(async () => {
  projects = new ProjectService(pool);
  members = new MemberService(pool);
  owner = await makeUser(pool);
  const p = await projects.create(owner, { slug: 'mteam', name: 'x' });
  projectId = p.id;
});

describe('MemberService', () => {
  it('owner can add a member by email', async () => {
    const u2 = await makeUser(pool, 'm1@t.co');
    const m = await members.add(projectId, owner, { email: 'm1@t.co', role: 'member' });
    expect(m.userId).toBe(u2);
    expect(m.role).toBe('member');
  });

  it('add by unknown email throws not_found', async () => {
    await expect(members.add(projectId, owner, { email: 'ghost@t.co', role: 'member' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('non-owner cannot add', async () => {
    const u2 = await makeUser(pool, 'm2@t.co');
    await members.add(projectId, owner, { email: 'm2@t.co', role: 'member' });
    await expect(members.add(projectId, u2, { email: 'someone@t.co', role: 'member' }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('list returns email + role', async () => {
    const list = await members.list(projectId, owner);
    expect(list.find((x) => x.email === 'm1@t.co')?.role).toBe('member');
  });

  it('remove drops member', async () => {
    const u3 = await makeUser(pool, 'm3@t.co');
    await members.add(projectId, owner, { email: 'm3@t.co', role: 'member' });
    await members.remove(projectId, owner, u3);
    const list = await members.list(projectId, owner);
    expect(list.find((x) => x.email === 'm3@t.co')).toBeUndefined();
  });
});
