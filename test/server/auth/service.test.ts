import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuthService } from '../../../src/server/auth/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { AppError } from '../../../src/shared/errors.js';

let svc: AuthService;
const pool = await freshSchema();
beforeAll(() => { svc = new AuthService(pool); });
afterAll(() => closePool(pool));

describe('AuthService', () => {
  it('signup creates user and login returns session token', async () => {
    const u = await svc.signup({ email: 'a@b.c', password: 'password123', name: 'A' });
    expect(u.email).toBe('a@b.c');
    const tok = await svc.login({ email: 'a@b.c', password: 'password123' });
    expect(tok).toMatch(/^cs_s_/);
    const me = await svc.resolveSessionToken(tok);
    expect(me?.email).toBe('a@b.c');
  });

  it('login with wrong password throws unauthorized', async () => {
    await svc.signup({ email: 'b@b.c', password: 'password123' });
    await expect(svc.login({ email: 'b@b.c', password: 'wrong-pass' }))
      .rejects.toMatchObject({ code: 'unauthorized' } satisfies Partial<AppError>);
  });

  it('mintApiKey returns raw key once and verify resolves to user', async () => {
    const u = await svc.signup({ email: 'c@b.c', password: 'password123' });
    const { id, raw } = await svc.mintApiKey(u.id, 'my-laptop');
    expect(raw).toMatch(/^cs_k_/);
    expect(id).toBeTruthy();
    const got = await svc.resolveApiKey(raw);
    expect(got?.id).toBe(u.id);
    const bad = await svc.resolveApiKey('cs_k_notreal');
    expect(bad).toBeNull();
  });

  it('listKeys does not return raw values', async () => {
    const u = await svc.signup({ email: 'd@b.c', password: 'password123' });
    await svc.mintApiKey(u.id, 'one');
    const ks = await svc.listKeys(u.id);
    expect(ks).toHaveLength(1);
    expect(ks[0]).not.toHaveProperty('raw');
    expect(ks[0]).not.toHaveProperty('hash');
  });

  it('revokeKey deletes the key', async () => {
    const u = await svc.signup({ email: 'e@b.c', password: 'password123' });
    const { id, raw } = await svc.mintApiKey(u.id, 'one');
    await svc.revokeKey(u.id, id);
    expect(await svc.resolveApiKey(raw)).toBeNull();
  });

  it('signup with existing email throws conflict', async () => {
    await svc.signup({ email: 'f@b.c', password: 'password123' });
    await expect(svc.signup({ email: 'f@b.c', password: 'password123' }))
      .rejects.toMatchObject({ code: 'conflict' });
  });
});
