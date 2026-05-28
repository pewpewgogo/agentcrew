create extension if not exists pgcrypto;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  password_hash text,
  created_at    timestamptz not null default now()
);

create table api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  hash          text not null,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index on api_keys (user_id);
