import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors.js';
import type { AuthService } from './service.js';
import type { User } from '../../shared/types.js';
import type { AuthorKind } from '../../shared/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    authorKind?: AuthorKind;
  }
}

export function makeAuthMiddleware(auth: AuthService) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 'missing bearer token', 401);
    }
    const token = header.slice(7);
    const user = token.startsWith('cs_s_')
      ? await auth.resolveSessionToken(token)
      : await auth.resolveApiKey(token);
    if (!user) throw new AppError('unauthorized', 'invalid token', 401);
    req.user = user;
    req.authorKind = token.startsWith('cs_s_') ? 'human' : 'agent';
  };
}
