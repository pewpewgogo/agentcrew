import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AppError } from '../shared/errors.js';
import { AuthService } from './auth/service.js';
import { ProjectService } from './projects/service.js';
import { MemberService } from './projects/members.service.js';
import { KbService } from './kb/service.js';
import { MilestoneService } from './milestones/service.js';
import { TaskService } from './tasks/service.js';
import { ContextService } from './context/service.js';
import { makeAuthMiddleware } from './auth/middleware.js';

import { registerAuthRoutes } from './auth/routes.js';
import { registerProjectRoutes } from './projects/routes.js';
import { registerKbRoutes } from './kb/routes.js';
import { registerMilestoneRoutes } from './milestones/routes.js';
import { registerTaskRoutes } from './tasks/routes.js';
import { registerContextRoutes } from './context/routes.js';
import { registerMcp } from '../mcp/server.js';

export interface Services {
  auth: AuthService; projects: ProjectService; members: MemberService;
  kb: KbService; milestones: MilestoneService; tasks: TaskService; context: ContextService;
}

export function buildServices(pool: Pool): Services {
  return {
    auth: new AuthService(pool),
    projects: new ProjectService(pool),
    members: new MemberService(pool),
    kb: new KbService(pool),
    milestones: new MilestoneService(pool),
    tasks: new TaskService(pool),
    context: new ContextService(pool),
  };
}

export async function buildApp(pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const services = buildServices(pool);
  const auth = makeAuthMiddleware(services.auth);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if ((err as any).validation) {
      return reply.status(422).send({
        error: { code: 'validation_failed', message: 'invalid input', details: (err as any).validation },
      });
    }
    reply.status(500).send({ error: { code: 'internal_error', message: 'internal error' } });
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.register(async (v1) => {
    registerAuthRoutes(v1, services, auth);
    v1.register(async (priv) => {
      priv.addHook('preHandler', auth);
      registerProjectRoutes(priv, services);
      registerKbRoutes(priv, services);
      registerMilestoneRoutes(priv, services);
      registerTaskRoutes(priv, services);
      registerContextRoutes(priv, services);
    });
  }, { prefix: '/v1' });

  await registerMcp(app, services);

  return app;
}
