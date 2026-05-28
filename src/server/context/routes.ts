import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { AddContextInput, GetContextQuery } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

async function memberOfProject(s: Services, projectId: string, userId: string): Promise<void> {
  const role = await s.projects.roleFor(projectId, userId);
  if (!role) throw new AppError('not_found', 'target not found', 404);
}

const serialize = (e: any) => ({
  id: e.id, project_id: e.projectId,
  target_type: e.targetType, target_id: e.targetId,
  author_user_id: e.authorUserId, author_kind: e.authorKind,
  note: e.note, created_at: e.createdAt,
});

export function registerContextRoutes(app: FastifyInstance, s: Services): void {
  app.post('/context', async (req, reply) => {
    const parsed = AddContextInput.parse(req.body);
    const projectId =
      parsed.target_type === 'project' ? parsed.target_id
      : parsed.target_type === 'milestone' ? await s.milestones.projectIdOf(parsed.target_id)
      : await s.tasks.projectIdOf(parsed.target_id);
    await memberOfProject(s, projectId, req.user!.id);
    const e = await s.context.append({
      authorUserId: req.user!.id, authorKind: req.authorKind ?? 'human',
      targetType: parsed.target_type, targetId: parsed.target_id, note: parsed.note,
    });
    reply.status(201).send(serialize(e));
  });

  app.get('/context', async (req) => {
    const q = GetContextQuery.parse(req.query);
    let projectId: string | undefined;
    if (q.project) {
      const p = await s.projects.getBySlugForUser(q.project, req.user!.id);
      projectId = p.id;
    }
    const entries = await s.context.query({ ...q, project: projectId });
    // filter to projects the user is a member of when no project was specified
    if (!q.project) {
      const memberships = (await s.projects.listForUser(req.user!.id)).map((p) => p.id);
      return entries.filter((e) => memberships.includes(e.projectId)).map(serialize);
    }
    return entries.map(serialize);
  });
}
