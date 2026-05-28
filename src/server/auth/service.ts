import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AppError } from '../../shared/errors.js';
import type { User, ApiKeyMeta } from '../../shared/types.js';

const SESSION_PREFIX = 'cs_s_';
const KEY_PREFIX = 'cs_k_';

function randomToken(prefix: string): string {
  return prefix + randomBytes(24).toString('base64url');
}

export class AuthService {
  constructor(private readonly pool: Pool) {}

  async signup(input: { email: string; password: string; name?: string }): Promise<User> {
    const hash = await argon2.hash(input.password);
    try {
      const r = await this.pool.query<{ id: string; email: string; name: string | null; created_at: Date }>(
        `insert into users (email, name, password_hash) values ($1, $2, $3)
         returning id, email, name, created_at`,
        [input.email, input.name ?? null, hash],
      );
      const row = r.rows[0]!;
      return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
    } catch (e: any) {
      if (e.code === '23505') throw new AppError('conflict', 'email already registered', 409);
      throw e;
    }
  }

  async login(input: { email: string; password: string }): Promise<string> {
    const r = await this.pool.query<{ id: string; password_hash: string | null }>(
      `select id, password_hash from users where email = $1`,
      [input.email],
    );
    const row = r.rows[0];
    if (!row || !row.password_hash) throw new AppError('unauthorized', 'invalid credentials', 401);
    const ok = await argon2.verify(row.password_hash, input.password);
    if (!ok) throw new AppError('unauthorized', 'invalid credentials', 401);

    const token = randomToken(SESSION_PREFIX);
    const hash = await argon2.hash(token);
    await this.pool.query(
      `insert into api_keys (user_id, name, hash) values ($1, $2, $3)`,
      [row.id, '__session__', hash],
    );
    return token;
  }

  async resolveSessionToken(token: string): Promise<User | null> {
    return this.resolveAnyToken(token, SESSION_PREFIX);
  }

  async resolveApiKey(key: string): Promise<User | null> {
    return this.resolveAnyToken(key, KEY_PREFIX);
  }

  private async resolveAnyToken(raw: string, expectedPrefix: string): Promise<User | null> {
    if (!raw.startsWith(expectedPrefix)) return null;
    // We must check against every stored hash for this token style; in practice we look up by
    // user via session/cookie or store an index. For simplicity v1: load candidates by name marker.
    const nameFilter = expectedPrefix === SESSION_PREFIX ? '__session__' : null;
    const q = nameFilter
      ? `select k.id, k.user_id, k.hash, u.email, u.name, u.created_at
           from api_keys k join users u on u.id = k.user_id where k.name = $1`
      : `select k.id, k.user_id, k.hash, u.email, u.name, u.created_at
           from api_keys k join users u on u.id = k.user_id where k.name <> '__session__'`;
    const r = await this.pool.query<{
      id: string; user_id: string; hash: string;
      email: string; name: string | null; created_at: Date;
    }>(q, nameFilter ? [nameFilter] : []);
    for (const row of r.rows) {
      if (await argon2.verify(row.hash, raw)) {
        await this.pool.query(`update api_keys set last_used_at = now() where id = $1`, [row.id]);
        return { id: row.user_id, email: row.email, name: row.name, createdAt: row.created_at };
      }
    }
    return null;
  }

  async mintApiKey(userId: string, name: string): Promise<{ id: string; raw: string }> {
    const raw = randomToken(KEY_PREFIX);
    const hash = await argon2.hash(raw);
    const r = await this.pool.query<{ id: string }>(
      `insert into api_keys (user_id, name, hash) values ($1, $2, $3) returning id`,
      [userId, name, hash],
    );
    return { id: r.rows[0]!.id, raw };
  }

  async listKeys(userId: string): Promise<ApiKeyMeta[]> {
    const r = await this.pool.query<{ id: string; name: string; last_used_at: Date | null; created_at: Date }>(
      `select id, name, last_used_at, created_at from api_keys
        where user_id = $1 and name <> '__session__' order by created_at desc`,
      [userId],
    );
    return r.rows.map((x) => ({ id: x.id, name: x.name, lastUsedAt: x.last_used_at, createdAt: x.created_at }));
  }

  async revokeKey(userId: string, keyId: string): Promise<void> {
    const r = await this.pool.query(
      `delete from api_keys where id = $1 and user_id = $2`,
      [keyId, userId],
    );
    if (r.rowCount === 0) throw new AppError('not_found', 'api key not found', 404);
  }
}
