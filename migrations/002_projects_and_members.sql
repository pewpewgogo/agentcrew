create table projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

create table project_members (
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null check (role in ('owner','member','viewer')),
  primary key (project_id, user_id)
);
create index on project_members (user_id);
