import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { Services } from '../app.js';
import { SignupInput, LoginInput, CreateApiKeyInput } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

export function registerAuthRoutes(app: FastifyInstance, s: Services, auth: preHandlerAsyncHookHandler): void {
  app.post('/auth/signup', async (req, reply) => {
    const parsed = SignupInput.parse(req.body);
    const user = await s.auth.signup(parsed);
    reply.status(201).send({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/auth/login', async (req) => {
    const parsed = LoginInput.parse(req.body);
    const token = await s.auth.login(parsed);
    return { token };
  });

  app.register(async (priv) => {
    priv.addHook('preHandler', auth);

    priv.get('/auth/me', async (req) => {
      if (!req.user) throw new AppError('unauthorized', 'no user', 401);
      return { id: req.user.id, email: req.user.email, name: req.user.name };
    });

    priv.post('/auth/keys', async (req, reply) => {
      const parsed = CreateApiKeyInput.parse(req.body);
      const out = await s.auth.mintApiKey(req.user!.id, parsed.name);
      reply.status(201).send(out);
    });

    priv.get('/auth/keys', async (req) => s.auth.listKeys(req.user!.id));

    priv.delete<{ Params: { id: string } }>('/auth/keys/:id', async (req, reply) => {
      await s.auth.revokeKey(req.user!.id, req.params.id);
      reply.status(204).send();
    });
  });
}
