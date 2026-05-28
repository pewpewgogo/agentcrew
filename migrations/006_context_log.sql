create table context_log (
  id             bigserial primary key,
  project_id     uuid not null references projects(id) on delete cascade,
  target_type    text not null check (target_type in ('project','milestone','task')),
  target_id      uuid not null,
  author_user_id uuid not null references users(id),
  author_kind    text not null check (author_kind in ('human','agent')),
  note           text not null,
  created_at     timestamptz not null default now()
);
create index on context_log (project_id, created_at desc);
create index on context_log (target_type, target_id, created_at desc);
