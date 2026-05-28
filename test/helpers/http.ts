import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../../src/server/app.js';

export async function buildTestApp(pool: Pool): Promise<FastifyInstance> {
  const app = await buildApp(pool);
  await app.ready();
  return app;
}

export async function asUser(app: FastifyInstance, email: string, password = 'password123', name = 'Test'): Promise<string> {
  await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, password, name } });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  return JSON.parse(r.payload).token as string;
}
