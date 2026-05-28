export type Role = 'owner' | 'member' | 'viewer';
export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'med' | 'high';
export type MilestoneStatus = 'open' | 'done';
export type AuthorKind = 'human' | 'agent';
export type TargetType = 'project' | 'milestone' | 'task';

export interface User { id: string; email: string; name: string | null; createdAt: Date }
export interface ApiKeyMeta { id: string; name: string; lastUsedAt: Date | null; createdAt: Date }
export interface Project {
  id: string; slug: string; name: string; description: string | null;
  createdBy: string; createdAt: Date;
}
export interface Member { userId: string; email: string; role: Role }
export interface Kb {
  repos: { label: string; url: string }[];
  urls: { label: string; url: string }[];
  techStack: string[];
  notes: string;
  updatedAt: Date;
}
export interface Milestone {
  id: string; projectId: string; title: string; goal: string | null;
  status: MilestoneStatus; orderIndex: number; dueDate: string | null; createdAt: Date;
}
export interface Task {
  id: string; projectId: string; milestoneId: string | null;
  title: string; description: string | null; goal: string | null;
  status: TaskStatus; priority: TaskPriority;
  assigneeUserId: string | null; createdBy: string;
  createdAt: Date; updatedAt: Date;
}
export interface ContextEntry {
  id: number; projectId: string;
  targetType: TargetType; targetId: string;
  authorUserId: string; authorKind: AuthorKind;
  note: string; createdAt: Date;
}
