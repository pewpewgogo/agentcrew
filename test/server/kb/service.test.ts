import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KbService } from '../../../src/server/kb/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: KbService; let uid: string; let pid: string;
beforeAll(async () => {
  svc = new KbService(pool);
  uid = await makeUser(pool);
  pid = await makeProject(pool, uid);
});

describe('KbService', () => {
  it('get returns defaults for new project', async () => {
    const kb = await svc.get(pid);
    expect(kb.repos).toEqual([]);
    expect(kb.notes).toBe('');
  });

  it('update replaces typed fields and appends notes via service', async () => {
    await svc.update(pid, { repos: [{ label: 'main', url: 'https://github.com/x/y' }] });
    let kb = await svc.get(pid);
    expect(kb.repos[0]?.label).toBe('main');
    await svc.update(pid, { notes: 'hello' });
    kb = await svc.get(pid);
    expect(kb.notes).toBe('hello');
  });

  it('update is partial (other fields unchanged)', async () => {
    await svc.update(pid, { tech_stack: ['ts','postgres'] });
    const kb = await svc.get(pid);
    expect(kb.repos[0]?.label).toBe('main');
    expect(kb.techStack).toEqual(['ts','postgres']);
  });
});
