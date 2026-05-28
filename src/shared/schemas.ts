import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'slug: lowercase, digits, hyphens');
const uuid = z.string().uuid();

export const CreateApiKeyInput = z.object({ name: z.string().min(1).max(100) });

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const SignupInput = LoginInput.extend({ name: z.string().min(1).max(100).optional() });

export const CreateProjectInput = z.object({
  slug,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const UpdateProjectInput = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const AddMemberInput = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member', 'viewer']).default('member'),
});

const KbLink = z.object({ label: z.string().min(1).max(100), url: z.string().url() });
export const UpdateKbInput = z.object({
  repos: z.array(KbLink).optional(),
  urls: z.array(KbLink).optional(),
  tech_stack: z.array(z.string().min(1).max(50)).optional(),
  notes: z.string().max(20000).optional(),
});

export const CreateMilestoneInput = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().max(2000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const UpdateMilestoneInput = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().max(2000).nullable().optional(),
  status: z.enum(['open', 'done']).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  order_index: z.number().int().min(0).optional(),
});

export const CreateTaskInput = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().max(2000).optional(),
  description: z.string().max(10000).optional(),
  milestone_id: uuid.optional(),
  priority: z.enum(['low', 'med', 'high']).default('med'),
  assignee_user_id: uuid.optional(),
});

export const UpdateTaskInput = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().max(2000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  milestone_id: uuid.nullable().optional(),
  status: z.enum(['todo', 'doing', 'done', 'blocked']).optional(),
  priority: z.enum(['low', 'med', 'high']).optional(),
  assignee_user_id: uuid.nullable().optional(),
});

export const AddContextInput = z.object({
  target_type: z.enum(['project', 'milestone', 'task']),
  target_id: uuid,
  note: z.string().min(1).max(10000),
});

export const ListTasksQuery = z.object({
  milestone: uuid.optional(),
  status: z.enum(['todo', 'doing', 'done', 'blocked']).optional(),
  assignee: uuid.optional(),
  mine: z.coerce.boolean().optional(),
});

export const GetContextQuery = z.object({
  project: slug.optional(),
  target_type: z.enum(['project', 'milestone', 'task']).optional(),
  target_id: uuid.optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
