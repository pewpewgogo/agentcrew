create table tasks (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  milestone_id      uuid references milestones(id) on delete set null,
  title             text not null,
  description       text,
  goal              text,
  status            text not null default 'todo' check (status in ('todo','doing','done','blocked')),
  priority          text not null default 'med'  check (priority in ('low','med','high')),
  assignee_user_id  uuid references users(id) on delete set null,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on tasks (project_id, status);
create index on tasks (assignee_user_id, status);
