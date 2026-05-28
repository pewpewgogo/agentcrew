import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

async function requireMemberByTask(s: Services, taskId: string, userId: string, mutate: boolean): Promise<void> {
  const projectId = await s.tasks.projectIdOf(taskId);
  const role = await s.projects.roleFor(projectId, userId);
  if (!role) throw new AppError('not_found', 'task not found', 404);
  if (mutate && role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
}

export function registerTaskRoutes(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { slug: string } }>('/projects/:slug/tasks', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    const q = ListTasksQuery.parse(req.query);
    return s.tasks.listForProject(p.id, { ...q, userId: req.user!.id });
  });

  app.post<{ Params: { slug: string } }>('/projects/:slug/tasks', async (req, reply) => {
    const parsed = CreateTaskInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    if (p.role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
    const t = await s.tasks.create(p.id, req.user!.id, parsed);
    reply.status(201).send(t);
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    await requireMemberByTask(s, req.params.id, req.user!.id, false);
    const t = await s.tasks.get(req.params.id);
    const context = await s.context.query({
      project: t.projectId, targetType: 'task', targetId: t.id, limit: 50,
    });
    return { ...t, context };
  });

  app.patch<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    await requireMemberByTask(s, req.params.id, req.user!.id, true);
    const parsed = UpdateTaskInput.parse(req.body);
    return s.tasks.update(req.params.id, parsed);
  });

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    await requireMemberByTask(s, req.params.id, req.user!.id, true);
    await s.tasks.delete(req.params.id);
    reply.status(204).send();
  });
}
