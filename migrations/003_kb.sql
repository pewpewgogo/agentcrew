create table project_kb (
  project_id  uuid primary key references projects(id) on delete cascade,
  repos       jsonb not null default '[]'::jsonb,
  urls        jsonb not null default '[]'::jsonb,
  tech_stack  jsonb not null default '[]'::jsonb,
  notes       text not null default '',
  updated_at  timestamptz not null default now()
);
