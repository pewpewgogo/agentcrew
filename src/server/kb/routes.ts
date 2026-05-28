import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { UpdateKbInput } from '../../shared/schemas.js';

export function registerKbRoutes(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { slug: string } }>('/projects/:slug/kb', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.kb.get(p.id);
  });

  app.patch<{ Params: { slug: string } }>('/projects/:slug/kb', async (req) => {
    const parsed = UpdateKbInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.kb.update(p.id, parsed);
  });
}
