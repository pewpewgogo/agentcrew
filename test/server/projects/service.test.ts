import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProjectService } from '../../../src/server/projects/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: ProjectService;
let uid: string;
beforeAll(async () => {
  svc = new ProjectService(pool);
  uid = await makeUser(pool);
});

describe('ProjectService', () => {
  it('create makes project, kb row, and owner membership', async () => {
    const p = await svc.create(uid, { slug: 'acme', name: 'Acme' });
    expect(p.slug).toBe('acme');
    const mem = await pool.query(`select role from project_members where project_id=$1 and user_id=$2`, [p.id, uid]);
    expect(mem.rows[0]?.role).toBe('owner');
    const kb = await pool.query(`select 1 from project_kb where project_id=$1`, [p.id]);
    expect(kb.rowCount).toBe(1);
  });

  it('create with duplicate slug throws conflict', async () => {
    await svc.create(uid, { slug: 'dup-slug', name: 'x' });
    await expect(svc.create(uid, { slug: 'dup-slug', name: 'y' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('listForUser returns only memberships', async () => {
    const u2 = await makeUser(pool);
    await svc.create(u2, { slug: 'only-u2', name: 'x' });
    const list = await svc.listForUser(uid);
    expect(list.find((p) => p.slug === 'only-u2')).toBeUndefined();
  });

  it('getBySlug throws not_found for non-member', async () => {
    const u2 = await makeUser(pool);
    const p = await svc.create(u2, { slug: 'hidden', name: 'x' });
    await expect(svc.getBySlugForUser('hidden', uid)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('roleFor returns owner/member/viewer/null', async () => {
    const p = await svc.create(uid, { slug: 'role-test', name: 'x' });
    expect(await svc.roleFor(p.id, uid)).toBe('owner');
    const u2 = await makeUser(pool);
    expect(await svc.roleFor(p.id, u2)).toBeNull();
  });
});
