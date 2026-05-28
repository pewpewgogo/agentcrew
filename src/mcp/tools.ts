import type { Services } from '../server/app.js';
import { AppError } from '../shared/errors.js';
import {
  CreateProjectInput, UpdateKbInput, CreateMilestoneInput, UpdateMilestoneInput,
  CreateTaskInput, UpdateTaskInput, AddContextInput, GetContextQuery, ListTasksQuery,
} from '../shared/schemas.js';
import { z } from 'zod';
import type { AuthorKind } from '../shared/types.js';

export interface CallCtx { userId: string; authorKind: AuthorKind }

type Tool<Args> = {
  description: string;
  schema: z.ZodTypeAny;
  handler: (ctx: CallCtx, args: Args) => Promise<any>;
};

async function memberRole(s: Services, projectId: string, userId: string) {
  const role = await s.projects.roleFor(projectId, userId);
  if (!role) throw new AppError('not_found', 'project not found', 404);
  return role;
}

export function mcpTools(s: Services) {
  return {
    list_projects: {
      description: 'List projects the caller is a member of.',
      schema: z.object({}),
      handler: async ({ userId }: CallCtx) => s.projects.listForUser(userId),
    } satisfies Tool<{}>,

    get_project: {
      description: 'Get one project including KB and members.',
      schema: z.object({ slug: z.string() }),
      handler: async ({ userId }: CallCtx, args: { slug: string }) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        const kb = await s.kb.get(p.id);
        const members = await s.members.list(p.id, userId);
        return { ...p, kb, members };
      },
    } satisfies Tool<{ slug: string }>,

    create_project: {
      description: 'Create a new project. Caller becomes owner.',
      schema: CreateProjectInput,
      handler: async ({ userId }: CallCtx, args: any) => s.projects.create(userId, CreateProjectInput.parse(args)),
    } satisfies Tool<any>,

    get_kb: {
      description: 'Read the knowledge base for a project (repos, urls, tech_stack, notes).',
      schema: z.object({ slug: z.string() }),
      handler: async ({ userId }: CallCtx, args: { slug: string }) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        return s.kb.get(p.id);
      },
    } satisfies Tool<{ slug: string }>,

    update_kb: {
      description: 'Update knowledge base fields. Partial: any subset of repos, urls, tech_stack, notes.',
      schema: z.object({ slug: z.string() }).and(UpdateKbInput),
      handler: async ({ userId }: CallCtx, args: any) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        const role = await memberRole(s, p.id, userId);
        if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
        const { slug, ...patch } = args;
        return s.kb.update(p.id, UpdateKbInput.parse(patch));
      },
    } satisfies Tool<any>,

    list_milestones: {
      description: 'List milestones in a project.',
      schema: z.object({ slug: z.string() }),
      handler: async ({ userId }: CallCtx, args: { slug: string }) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        return s.milestones.listForProject(p.id);
      },
    } satisfies Tool<{ slug: string }>,

    create_milestone: {
      description: 'Create a milestone.',
      schema: z.object({ slug: z.string() }).and(CreateMilestoneInput),
      handler: async ({ userId }: CallCtx, args: any) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        const role = await memberRole(s, p.id, userId);
        if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
        const { slug, ...rest } = args;
        return s.milestones.create(p.id, CreateMilestoneInput.parse(rest));
      },
    } satisfies Tool<any>,

    update_milestone: {
      description: 'Update milestone fields.',
      schema: z.object({ id: z.string().uuid() }).and(UpdateMilestoneInput),
      handler: async ({ userId }: CallCtx, args: any) => {
        const projectId = await s.milestones.projectIdOf(args.id);
        const role = await memberRole(s, projectId, userId);
        if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
        const { id, ...patch } = args;
        return s.milestones.update(id, UpdateMilestoneInput.parse(patch));
      },
    } satisfies Tool<any>,

    list_tasks: {
      description: 'List tasks. Filter by milestone, status, assignee, or mine=true (assigned to caller).',
      schema: z.object({ slug: z.string() }).and(ListTasksQuery),
      handler: async ({ userId }: CallCtx, args: any) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        const { slug, ...filter } = args;
        return s.tasks.listForProject(p.id, { ...ListTasksQuery.parse(filter), userId });
      },
    } satisfies Tool<any>,

    get_task: {
      description: 'Get one task with recent context entries.',
      schema: z.object({ id: z.string().uuid() }),
      handler: async ({ userId }: CallCtx, args: { id: string }) => {
        const projectId = await s.tasks.projectIdOf(args.id);
        await memberRole(s, projectId, userId);
        const t = await s.tasks.get(args.id);
        const context = await s.context.query({
          project: t.projectId, targetType: 'task', targetId: t.id, limit: 50,
        });
        return { ...t, context };
      },
    } satisfies Tool<{ id: string }>,

    create_task: {
      description: 'Create a task in a project.',
      schema: z.object({ slug: z.string() }).and(CreateTaskInput),
      handler: async ({ userId }: CallCtx, args: any) => {
        const p = await s.projects.getBySlugForUser(args.slug, userId);
        const role = await memberRole(s, p.id, userId);
        if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
        const { slug, ...rest } = args;
        return s.tasks.create(p.id, userId, CreateTaskInput.parse(rest));
      },
    } satisfies Tool<any>,

    update_task: {
      description: 'Update task fields. Note: do not modify "goal" without asking the user first.',
      schema: z.object({ id: z.string().uuid() }).and(UpdateTaskInput),
      handler: async ({ userId }: CallCtx, args: any) => {
        const projectId = await s.tasks.projectIdOf(args.id);
        const role = await memberRole(s, projectId, userId);
        if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
        const { id, ...patch } = args;
        return s.tasks.update(id, UpdateTaskInput.parse(patch));
      },
    } satisfies Tool<any>,

    claim_task: {
      description: 'Assign a task to the calling user.',
      schema: z.object({ id: z.string().uuid() }),
      handler: async ({ userId }: CallCtx, args: { id: string }) => {
        const projectId = await s.tasks.projectIdOf(args.id);
        const role = await memberRole(s, projectId, userId);
        if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
        return s.tasks.claim(args.id, userId);
      },
    } satisfies Tool<{ id: string }>,

    add_context: {
      description: 'Append a note to the context log for a project, milestone, or task.',
      schema: AddContextInput,
      handler: async ({ userId, authorKind }: CallCtx, args: any) => {
        const parsed = AddContextInput.parse(args);
        const projectId =
          parsed.target_type === 'project' ? parsed.target_id
          : parsed.target_type === 'milestone' ? await s.milestones.projectIdOf(parsed.target_id)
          : await s.tasks.projectIdOf(parsed.target_id);
        await memberRole(s, projectId, userId);
        const e = await s.context.append({
          authorUserId: userId, authorKind,
          targetType: parsed.target_type, targetId: parsed.target_id, note: parsed.note,
        });
        return {
          id: e.id, project_id: e.projectId,
          target_type: e.targetType, target_id: e.targetId,
          author_user_id: e.authorUserId, author_kind: e.authorKind,
          note: e.note, created_at: e.createdAt,
        };
      },
    } satisfies Tool<any>,

    get_context: {
      description: 'Query context log entries.',
      schema: GetContextQuery,
      handler: async ({ userId }: CallCtx, args: any) => {
        const q = GetContextQuery.parse(args);
        let projectId: string | undefined;
        if (q.project) {
          const p = await s.projects.getBySlugForUser(q.project, userId);
          projectId = p.id;
        }
        const entries = await s.context.query({ ...q, project: projectId });
        const memberships = (await s.projects.listForUser(userId)).map((p) => p.id);
        return entries
          .filter((e) => memberships.includes(e.projectId))
          .map((e) => ({
            id: e.id, project_id: e.projectId,
            target_type: e.targetType, target_id: e.targetId,
            author_user_id: e.authorUserId, author_kind: e.authorKind,
            note: e.note, created_at: e.createdAt,
          }));
      },
    } satisfies Tool<any>,
  };
}
