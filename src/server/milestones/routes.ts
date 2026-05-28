import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { CreateMilestoneInput, UpdateMilestoneInput } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

async function requireMemberByMilestone(s: any, milestoneId: string, userId: string): Promise<void> {
  const projectId = await s.milestones.projectIdOf(milestoneId);
  const role = await s.projects.roleFor(projectId, userId);
  if (!role) throw new AppError('not_found', 'milestone not found', 404);
  if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
}

export function registerMilestoneRoutes(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { slug: string } }>('/projects/:slug/milestones', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.milestones.listForProject(p.id);
  });

  app.post<{ Params: { slug: string } }>('/projects/:slug/milestones', async (req, reply) => {
    const parsed = CreateMilestoneInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    if (p.role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
    const m = await s.milestones.create(p.id, parsed);
    reply.status(201).send(m);
  });

  app.patch<{ Params: { id: string } }>('/milestones/:id', async (req) => {
    await requireMemberByMilestone(s, req.params.id, req.user!.id);
    const parsed = UpdateMilestoneInput.parse(req.body);
    return s.milestones.update(req.params.id, parsed);
  });

  app.delete<{ Params: { id: string } }>('/milestones/:id', async (req, reply) => {
    await requireMemberByMilestone(s, req.params.id, req.user!.id);
    await s.milestones.delete(req.params.id);
    reply.status(204).send();
  });
}
