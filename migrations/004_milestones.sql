create table milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  title        text not null,
  goal         text,
  status       text not null default 'open' check (status in ('open','done')),
  order_index  int  not null default 0,
  due_date     date,
  created_at   timestamptz not null default now()
);
create index on milestones (project_id, order_index);
