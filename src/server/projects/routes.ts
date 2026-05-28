import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { CreateProjectInput, UpdateProjectInput, AddMemberInput } from '../../shared/schemas.js';

export function registerProjectRoutes(app: FastifyInstance, s: Services): void {
  app.get('/projects', async (req) => s.projects.listForUser(req.user!.id));

  app.post('/projects', async (req, reply) => {
    const parsed = CreateProjectInput.parse(req.body);
    const p = await s.projects.create(req.user!.id, parsed);
    reply.status(201).send(p);
  });

  app.get<{ Params: { slug: string } }>('/projects/:slug', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    const kb = await s.kb.get(p.id);
    const members = await s.members.list(p.id, req.user!.id);
    return { ...p, kb, members };
  });

  app.patch<{ Params: { slug: string } }>('/projects/:slug', async (req) => {
    const parsed = UpdateProjectInput.parse(req.body);
    return s.projects.update(req.params.slug, req.user!.id, parsed);
  });

  app.get<{ Params: { slug: string } }>('/projects/:slug/members', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.members.list(p.id, req.user!.id);
  });

  app.post<{ Params: { slug: string } }>('/projects/:slug/members', async (req, reply) => {
    const parsed = AddMemberInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    const m = await s.members.add(p.id, req.user!.id, parsed);
    reply.status(201).send(m);
  });

  app.delete<{ Params: { slug: string; uid: string } }>('/projects/:slug/members/:uid', async (req, reply) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    await s.members.remove(p.id, req.user!.id, req.params.uid);
    reply.status(204).send();
  });
}
