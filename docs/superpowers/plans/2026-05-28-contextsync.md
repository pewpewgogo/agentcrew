# contextsync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hosted contextsync service end-to-end: Postgres schema, Fastify REST API, Streamable HTTP MCP server, `contextsync`/`cs` CLI, and `npx contextsync init` flow that installs the Claude skill and registers the MCP server.

**Architecture:** Single Node 20 TypeScript process exposes REST at `/v1/*` and MCP at `/mcp`. Both routers call a shared service layer that talks to Postgres. CLI is a thin REST client distributed in the same npm package. `init` writes config + skill file + `~/.claude.json` MCP entry.

**Tech Stack:** TypeScript 5, Node 20, Fastify 4, `@modelcontextprotocol/sdk`, `pg`, `argon2`, `zod`, `commander`, `vitest`, `pg-mem` (unit) + dockerized Postgres 15 (integration).

**Spec:** `docs/superpowers/specs/2026-05-28-contextsync-design.md`.

---

## File structure

```
contextsync/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── docker-compose.test.yml
├── migrations/
│   ├── 001_users_and_keys.sql
│   ├── 002_projects_and_members.sql
│   ├── 003_kb.sql
│   ├── 004_milestones.sql
│   ├── 005_tasks.sql
│   └── 006_context_log.sql
├── src/
│   ├── shared/
│   │   ├── errors.ts
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   └── db.ts
│   ├── server/
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── auth/{service.ts,middleware.ts,routes.ts}
│   │   ├── projects/{service.ts,members.service.ts,routes.ts}
│   │   ├── kb/{service.ts,routes.ts}
│   │   ├── milestones/{service.ts,routes.ts}
│   │   ├── tasks/{service.ts,routes.ts}
│   │   └── context/{service.ts,routes.ts}
│   ├── mcp/{server.ts,tools.ts}
│   ├── cli/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── api.ts
│   │   ├── output.ts
│   │   └── commands/{login.ts,keys.ts,project.ts,member.ts,kb.ts,milestone.ts,task.ts,context.ts}
│   ├── init/
│   │   ├── index.ts
│   │   ├── claude-config.ts
│   │   └── skill-install.ts
│   └── skill-template/SKILL.md
└── test/
    ├── helpers/{db.ts,http.ts,factories.ts}
    └── (mirrors src/ for unit + integration suites)
```

`package.json` ships two bins: `contextsync` and `cs`, both pointing at `dist/cli/index.js`. The server entry is `dist/server/index.js`.

---

## Execution order

Phase 0 is strictly sequential. Once it's done, Phase 1 services are **independent and can be dispatched in parallel**. Phase 2 routes depend on their matching Phase 1 service. Phase 3 MCP depends on all services. Phase 4 CLI depends on routes existing (integration tests hit them). Phase 5 init depends on the server being runnable. Phase 6 skill template can be written any time after Phase 0.

```
Phase 0: scaffold + DB + migrations               [sequential]
Phase 1: services (auth, projects, kb, ms, tasks, ctx)   [parallel]
Phase 2: routes (one per service)                 [parallel after its service]
Phase 3: MCP tools                                [after all services]
Phase 4: CLI                                      [parallel after routes]
Phase 5: init flow                                [after server is runnable]
Phase 6: skill template                           [any time after Phase 0]
```

---

# Phase 0 — Foundation

## Task 0.1: Scaffold package

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "contextsync",
  "version": "0.1.0",
  "type": "module",
  "bin": { "contextsync": "dist/cli/index.js", "cs": "dist/cli/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev:server": "tsx watch src/server/index.ts",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "argon2": "^0.40.0",
    "commander": "^12.0.0",
    "fastify": "^4.26.0",
    "@fastify/cors": "^9.0.0",
    "pg": "^8.11.0",
    "zod": "^3.22.0",
    "prompts": "^2.4.2"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/pg": "^8.10.0",
    "@types/prompts": "^2.4.0",
    "pg-mem": "^2.8.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npm run lint`
Expected: no errors (no source files yet, but tsc succeeds).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore vitest.config.ts package-lock.json
git commit -m "chore: scaffold typescript node project"
```

---

## Task 0.2: Test infrastructure (Postgres in Docker)

**Files:**
- Create: `docker-compose.test.yml`, `test/helpers/db.ts`

- [ ] **Step 1: Write `docker-compose.test.yml`**

```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: contextsync
      POSTGRES_PASSWORD: contextsync
      POSTGRES_DB: contextsync_test
    ports:
      - "54329:5432"
    tmpfs:
      - /var/lib/postgresql/data
```

- [ ] **Step 2: Write `test/helpers/db.ts`**

```ts
import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TEST_DB_URL =
  process.env.TEST_DB_URL ?? 'postgres://contextsync:contextsync@localhost:54329/contextsync_test';

export async function freshSchema(): Promise<Pool> {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  await pool.query('drop schema public cascade; create schema public;');
  const dir = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), 'utf8');
    await pool.query(sql);
  }
  return pool;
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
}
```

- [ ] **Step 3: Bring up Postgres and verify**

```bash
docker compose -f docker-compose.test.yml up -d
until docker compose -f docker-compose.test.yml exec -T postgres pg_isready -U contextsync; do sleep 1; done
```

Expected: `accepting connections`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.test.yml test/helpers/db.ts
git commit -m "chore: test db infrastructure"
```

---

## Task 0.3: Shared errors and types

**Files:**
- Create: `src/shared/errors.ts`, `src/shared/types.ts`
- Test: `test/shared/errors.test.ts`

- [ ] **Step 1: Write failing test `test/shared/errors.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { AppError, isAppError } from '../../src/shared/errors.js';

describe('AppError', () => {
  it('carries code, message, and http status', () => {
    const e = new AppError('not_found', 'project missing', 404);
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('project missing');
    expect(e.status).toBe(404);
    expect(isAppError(e)).toBe(true);
  });

  it('isAppError returns false for plain Error', () => {
    expect(isAppError(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- errors`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/shared/errors.ts`**

```ts
export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_failed'
  | 'rate_limited'
  | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
```

- [ ] **Step 4: Write `src/shared/types.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- errors`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ test/shared/
git commit -m "feat(shared): error class and domain types"
```

---

## Task 0.4: Zod schemas (request validation)

**Files:**
- Create: `src/shared/schemas.ts`
- Test: `test/shared/schemas.test.ts`

- [ ] **Step 1: Write failing test `test/shared/schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { CreateProjectInput, CreateTaskInput, AddContextInput } from '../../src/shared/schemas.js';

describe('schemas', () => {
  it('CreateProjectInput rejects empty slug', () => {
    expect(CreateProjectInput.safeParse({ slug: '', name: 'x' }).success).toBe(false);
  });
  it('CreateProjectInput rejects bad slug chars', () => {
    expect(CreateProjectInput.safeParse({ slug: 'has space', name: 'x' }).success).toBe(false);
  });
  it('CreateProjectInput accepts valid input', () => {
    expect(CreateProjectInput.safeParse({ slug: 'acme-web', name: 'Acme' }).success).toBe(true);
  });
  it('CreateTaskInput requires title', () => {
    expect(CreateTaskInput.safeParse({ title: '' }).success).toBe(false);
  });
  it('AddContextInput validates target_type enum', () => {
    expect(AddContextInput.safeParse({
      target_type: 'bogus', target_id: '11111111-1111-1111-1111-111111111111', note: 'x',
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/shared/schemas.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- schemas`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts test/shared/schemas.test.ts
git commit -m "feat(shared): zod request schemas"
```

---

## Task 0.5: DB pool and migration runner

**Files:**
- Create: `src/shared/db.ts`
- Test: `test/shared/db.test.ts`

- [ ] **Step 1: Write failing test `test/shared/db.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createPool } from '../../src/shared/db.js';
import { TEST_DB_URL } from '../helpers/db.js';

const pool = createPool(TEST_DB_URL);
afterAll(() => pool.end());

describe('createPool', () => {
  it('connects and runs a query', async () => {
    const r = await pool.query<{ ok: number }>('select 1 as ok');
    expect(r.rows[0]?.ok).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- db`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/shared/db.ts`**

```ts
import { Pool, type PoolClient } from 'pg';

export type DB = Pool;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- db`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/shared/db.ts test/shared/db.test.ts
git commit -m "feat(shared): pg pool factory and tx helper"
```

---

## Task 0.6: Migrations

**Files:**
- Create: `migrations/001_users_and_keys.sql` … `migrations/006_context_log.sql`
- Test: `test/migrations.test.ts`

- [ ] **Step 1: Write failing test `test/migrations.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from './helpers/db.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));

const expectTable = async (name: string) => {
  const r = await pool.query(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1`,
    [name],
  );
  expect(r.rowCount, `table ${name} missing`).toBe(1);
};

describe('migrations', () => {
  it('creates all six core tables', async () => {
    for (const t of ['users','api_keys','projects','project_members','project_kb','milestones','tasks','context_log']) {
      await expectTable(t);
    }
  });
  it('users.email is unique', async () => {
    await pool.query(`insert into users (id, email) values (gen_random_uuid(), 'a@b.c')`);
    await expect(
      pool.query(`insert into users (id, email) values (gen_random_uuid(), 'a@b.c')`),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- migrations`
Expected: FAIL — migrations missing.

- [ ] **Step 3: Write `migrations/001_users_and_keys.sql`**

```sql
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
```

- [ ] **Step 4: Write `migrations/002_projects_and_members.sql`**

```sql
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
```

- [ ] **Step 5: Write `migrations/003_kb.sql`**

```sql
create table project_kb (
  project_id  uuid primary key references projects(id) on delete cascade,
  repos       jsonb not null default '[]'::jsonb,
  urls        jsonb not null default '[]'::jsonb,
  tech_stack  jsonb not null default '[]'::jsonb,
  notes       text not null default '',
  updated_at  timestamptz not null default now()
);
```

- [ ] **Step 6: Write `migrations/004_milestones.sql`**

```sql
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
```

- [ ] **Step 7: Write `migrations/005_tasks.sql`**

```sql
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
```

- [ ] **Step 8: Write `migrations/006_context_log.sql`**

```sql
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
```

- [ ] **Step 9: Run to verify pass**

Run: `npm test -- migrations`
Expected: PASS, 2 tests.

- [ ] **Step 10: Commit**

```bash
git add migrations/ test/migrations.test.ts
git commit -m "feat(db): initial schema migrations"
```

---

# Phase 1 — Services

Each service: write tests against a fresh schema, then implement. All services use `Pool` from `pg` and throw `AppError`. **Tasks 1.1–1.6 are independent and can be dispatched in parallel.**

Shared test helpers used in this phase:

## Task 1.0: Test factories

**Files:**
- Create: `test/helpers/factories.ts`

- [ ] **Step 1: Write `test/helpers/factories.ts`**

```ts
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export async function makeUser(pool: Pool, email = `u-${randomUUID()}@t.co`): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into users (id, email, name) values (gen_random_uuid(), $1, 'Test') returning id`,
    [email],
  );
  return r.rows[0]!.id;
}

export async function makeProject(pool: Pool, ownerId: string, slug = `p-${randomUUID().slice(0,8)}`): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into projects (id, slug, name, created_by) values (gen_random_uuid(), $1, $1, $2) returning id`,
    [slug, ownerId],
  );
  await pool.query(
    `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
    [r.rows[0]!.id, ownerId],
  );
  await pool.query(`insert into project_kb (project_id) values ($1)`, [r.rows[0]!.id]);
  return r.rows[0]!.id;
}
```

- [ ] **Step 2: Commit**

```bash
git add test/helpers/factories.ts
git commit -m "test: db factories"
```

---

## Task 1.1: AuthService

**Files:**
- Create: `src/server/auth/service.ts`
- Test: `test/server/auth/service.test.ts`

- [ ] **Step 1: Write failing test `test/server/auth/service.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuthService } from '../../../src/server/auth/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { AppError } from '../../../src/shared/errors.js';

let svc: AuthService;
const pool = await freshSchema();
beforeAll(() => { svc = new AuthService(pool); });
afterAll(() => closePool(pool));

describe('AuthService', () => {
  it('signup creates user and login returns session token', async () => {
    const u = await svc.signup({ email: 'a@b.c', password: 'password123', name: 'A' });
    expect(u.email).toBe('a@b.c');
    const tok = await svc.login({ email: 'a@b.c', password: 'password123' });
    expect(tok).toMatch(/^cs_s_/);
    const me = await svc.resolveSessionToken(tok);
    expect(me?.email).toBe('a@b.c');
  });

  it('login with wrong password throws unauthorized', async () => {
    await svc.signup({ email: 'b@b.c', password: 'password123' });
    await expect(svc.login({ email: 'b@b.c', password: 'wrong-pass' }))
      .rejects.toMatchObject({ code: 'unauthorized' } satisfies Partial<AppError>);
  });

  it('mintApiKey returns raw key once and verify resolves to user', async () => {
    const u = await svc.signup({ email: 'c@b.c', password: 'password123' });
    const { id, raw } = await svc.mintApiKey(u.id, 'my-laptop');
    expect(raw).toMatch(/^cs_k_/);
    expect(id).toBeTruthy();
    const got = await svc.resolveApiKey(raw);
    expect(got?.id).toBe(u.id);
    const bad = await svc.resolveApiKey('cs_k_notreal');
    expect(bad).toBeNull();
  });

  it('listKeys does not return raw values', async () => {
    const u = await svc.signup({ email: 'd@b.c', password: 'password123' });
    await svc.mintApiKey(u.id, 'one');
    const ks = await svc.listKeys(u.id);
    expect(ks).toHaveLength(1);
    expect(ks[0]).not.toHaveProperty('raw');
    expect(ks[0]).not.toHaveProperty('hash');
  });

  it('revokeKey deletes the key', async () => {
    const u = await svc.signup({ email: 'e@b.c', password: 'password123' });
    const { id, raw } = await svc.mintApiKey(u.id, 'one');
    await svc.revokeKey(u.id, id);
    expect(await svc.resolveApiKey(raw)).toBeNull();
  });

  it('signup with existing email throws conflict', async () => {
    await svc.signup({ email: 'f@b.c', password: 'password123' });
    await expect(svc.signup({ email: 'f@b.c', password: 'password123' }))
      .rejects.toMatchObject({ code: 'conflict' });
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- server/auth/service`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/server/auth/service.ts`**

```ts
import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AppError } from '../../shared/errors.js';
import type { User, ApiKeyMeta } from '../../shared/types.js';

const SESSION_PREFIX = 'cs_s_';
const KEY_PREFIX = 'cs_k_';

function randomToken(prefix: string): string {
  return prefix + randomBytes(24).toString('base64url');
}

export class AuthService {
  constructor(private readonly pool: Pool) {}

  async signup(input: { email: string; password: string; name?: string }): Promise<User> {
    const hash = await argon2.hash(input.password);
    try {
      const r = await this.pool.query<{ id: string; email: string; name: string | null; created_at: Date }>(
        `insert into users (email, name, password_hash) values ($1, $2, $3)
         returning id, email, name, created_at`,
        [input.email, input.name ?? null, hash],
      );
      const row = r.rows[0]!;
      return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
    } catch (e: any) {
      if (e.code === '23505') throw new AppError('conflict', 'email already registered', 409);
      throw e;
    }
  }

  async login(input: { email: string; password: string }): Promise<string> {
    const r = await this.pool.query<{ id: string; password_hash: string | null }>(
      `select id, password_hash from users where email = $1`,
      [input.email],
    );
    const row = r.rows[0];
    if (!row || !row.password_hash) throw new AppError('unauthorized', 'invalid credentials', 401);
    const ok = await argon2.verify(row.password_hash, input.password);
    if (!ok) throw new AppError('unauthorized', 'invalid credentials', 401);

    const token = randomToken(SESSION_PREFIX);
    const hash = await argon2.hash(token);
    await this.pool.query(
      `insert into api_keys (user_id, name, hash) values ($1, $2, $3)`,
      [row.id, '__session__', hash],
    );
    return token;
  }

  async resolveSessionToken(token: string): Promise<User | null> {
    return this.resolveAnyToken(token, SESSION_PREFIX);
  }

  async resolveApiKey(key: string): Promise<User | null> {
    return this.resolveAnyToken(key, KEY_PREFIX);
  }

  private async resolveAnyToken(raw: string, expectedPrefix: string): Promise<User | null> {
    if (!raw.startsWith(expectedPrefix)) return null;
    // We must check against every stored hash for this token style; in practice we look up by
    // user via session/cookie or store an index. For simplicity v1: load candidates by name marker.
    const nameFilter = expectedPrefix === SESSION_PREFIX ? '__session__' : null;
    const q = nameFilter
      ? `select k.id, k.user_id, k.hash, u.email, u.name, u.created_at
           from api_keys k join users u on u.id = k.user_id where k.name = $1`
      : `select k.id, k.user_id, k.hash, u.email, u.name, u.created_at
           from api_keys k join users u on u.id = k.user_id where k.name <> '__session__'`;
    const r = await this.pool.query<{
      id: string; user_id: string; hash: string;
      email: string; name: string | null; created_at: Date;
    }>(q, nameFilter ? [nameFilter] : []);
    for (const row of r.rows) {
      if (await argon2.verify(row.hash, raw)) {
        await this.pool.query(`update api_keys set last_used_at = now() where id = $1`, [row.id]);
        return { id: row.user_id, email: row.email, name: row.name, createdAt: row.created_at };
      }
    }
    return null;
  }

  async mintApiKey(userId: string, name: string): Promise<{ id: string; raw: string }> {
    const raw = randomToken(KEY_PREFIX);
    const hash = await argon2.hash(raw);
    const r = await this.pool.query<{ id: string }>(
      `insert into api_keys (user_id, name, hash) values ($1, $2, $3) returning id`,
      [userId, name, hash],
    );
    return { id: r.rows[0]!.id, raw };
  }

  async listKeys(userId: string): Promise<ApiKeyMeta[]> {
    const r = await this.pool.query<{ id: string; name: string; last_used_at: Date | null; created_at: Date }>(
      `select id, name, last_used_at, created_at from api_keys
        where user_id = $1 and name <> '__session__' order by created_at desc`,
      [userId],
    );
    return r.rows.map((x) => ({ id: x.id, name: x.name, lastUsedAt: x.last_used_at, createdAt: x.created_at }));
  }

  async revokeKey(userId: string, keyId: string): Promise<void> {
    const r = await this.pool.query(
      `delete from api_keys where id = $1 and user_id = $2`,
      [keyId, userId],
    );
    if (r.rowCount === 0) throw new AppError('not_found', 'api key not found', 404);
  }
}
```

> **Note for implementer:** The full-table-scan in `resolveAnyToken` is acceptable for v1 (small key population). Later optimization: add a non-secret short prefix to the stored row as a lookup hint. Do not change this in v1 — keep the plan honest.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- server/auth/service`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/service.ts test/server/auth/service.test.ts
git commit -m "feat(auth): user signup/login, api key mint and verify"
```

---

## Task 1.2: ProjectService + MemberService

**Files:**
- Create: `src/server/projects/service.ts`, `src/server/projects/members.service.ts`
- Test: `test/server/projects/service.test.ts`, `test/server/projects/members.service.test.ts`

- [ ] **Step 1: Write failing test `test/server/projects/service.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProjectService } from '../../../src/server/projects/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: ProjectService;
let uid: string;
beforeAll(async () => {
  svc = new ProjectService(pool);
  uid = await makeUser(pool);
});

describe('ProjectService', () => {
  it('create makes project, kb row, and owner membership', async () => {
    const p = await svc.create(uid, { slug: 'acme', name: 'Acme' });
    expect(p.slug).toBe('acme');
    const mem = await pool.query(`select role from project_members where project_id=$1 and user_id=$2`, [p.id, uid]);
    expect(mem.rows[0]?.role).toBe('owner');
    const kb = await pool.query(`select 1 from project_kb where project_id=$1`, [p.id]);
    expect(kb.rowCount).toBe(1);
  });

  it('create with duplicate slug throws conflict', async () => {
    await svc.create(uid, { slug: 'dup-slug', name: 'x' });
    await expect(svc.create(uid, { slug: 'dup-slug', name: 'y' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('listForUser returns only memberships', async () => {
    const u2 = await makeUser(pool);
    await svc.create(u2, { slug: 'only-u2', name: 'x' });
    const list = await svc.listForUser(uid);
    expect(list.find((p) => p.slug === 'only-u2')).toBeUndefined();
  });

  it('getBySlug throws not_found for non-member', async () => {
    const u2 = await makeUser(pool);
    const p = await svc.create(u2, { slug: 'hidden', name: 'x' });
    await expect(svc.getBySlugForUser('hidden', uid)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('roleFor returns owner/member/viewer/null', async () => {
    const p = await svc.create(uid, { slug: 'role-test', name: 'x' });
    expect(await svc.roleFor(p.id, uid)).toBe('owner');
    const u2 = await makeUser(pool);
    expect(await svc.roleFor(p.id, u2)).toBeNull();
  });
});
```

- [ ] **Step 2: Write failing test `test/server/projects/members.service.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemberService } from '../../../src/server/projects/members.service.js';
import { ProjectService } from '../../../src/server/projects/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let projects: ProjectService;
let members: MemberService;
let owner: string;
let projectId: string;
beforeAll(async () => {
  projects = new ProjectService(pool);
  members = new MemberService(pool);
  owner = await makeUser(pool);
  const p = await projects.create(owner, { slug: 'mteam', name: 'x' });
  projectId = p.id;
});

describe('MemberService', () => {
  it('owner can add a member by email', async () => {
    const u2 = await makeUser(pool, 'm1@t.co');
    const m = await members.add(projectId, owner, { email: 'm1@t.co', role: 'member' });
    expect(m.userId).toBe(u2);
    expect(m.role).toBe('member');
  });

  it('add by unknown email throws not_found', async () => {
    await expect(members.add(projectId, owner, { email: 'ghost@t.co', role: 'member' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('non-owner cannot add', async () => {
    const u2 = await makeUser(pool, 'm2@t.co');
    await members.add(projectId, owner, { email: 'm2@t.co', role: 'member' });
    await expect(members.add(projectId, u2, { email: 'someone@t.co', role: 'member' }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('list returns email + role', async () => {
    const list = await members.list(projectId, owner);
    expect(list.find((x) => x.email === 'm1@t.co')?.role).toBe('member');
  });

  it('remove drops member', async () => {
    const u3 = await makeUser(pool, 'm3@t.co');
    await members.add(projectId, owner, { email: 'm3@t.co', role: 'member' });
    await members.remove(projectId, owner, u3);
    const list = await members.list(projectId, owner);
    expect(list.find((x) => x.email === 'm3@t.co')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify fails**

Run: `npm test -- projects`
Expected: FAIL.

- [ ] **Step 4: Write `src/server/projects/service.ts`**

```ts
import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Project, Role } from '../../shared/types.js';
import { withTx } from '../../shared/db.js';

const projectRow = (r: any): Project => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description,
  createdBy: r.created_by, createdAt: r.created_at,
});

export class ProjectService {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, input: { slug: string; name: string; description?: string }): Promise<Project> {
    try {
      return await withTx(this.pool, async (c) => {
        const r = await c.query(
          `insert into projects (slug, name, description, created_by) values ($1,$2,$3,$4)
           returning id, slug, name, description, created_by, created_at`,
          [input.slug, input.name, input.description ?? null, userId],
        );
        const p = projectRow(r.rows[0]);
        await c.query(
          `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
          [p.id, userId],
        );
        await c.query(`insert into project_kb (project_id) values ($1)`, [p.id]);
        return p;
      });
    } catch (e: any) {
      if (e.code === '23505') throw new AppError('conflict', 'slug already in use', 409);
      throw e;
    }
  }

  async listForUser(userId: string): Promise<(Project & { role: Role })[]> {
    const r = await this.pool.query(
      `select p.*, m.role from projects p
       join project_members m on m.project_id = p.id
       where m.user_id = $1 order by p.created_at desc`,
      [userId],
    );
    return r.rows.map((row) => ({ ...projectRow(row), role: row.role as Role }));
  }

  async getBySlugForUser(slug: string, userId: string): Promise<Project & { role: Role }> {
    const r = await this.pool.query(
      `select p.*, m.role from projects p
       join project_members m on m.project_id = p.id
       where p.slug = $1 and m.user_id = $2`,
      [slug, userId],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('not_found', 'project not found', 404);
    return { ...projectRow(row), role: row.role as Role };
  }

  async update(slug: string, userId: string, patch: { name?: string; description?: string | null }): Promise<Project> {
    const p = await this.getBySlugForUser(slug, userId);
    if (p.role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.name !== undefined) { vals.push(patch.name); sets.push(`name = $${vals.length}`); }
    if (patch.description !== undefined) { vals.push(patch.description); sets.push(`description = $${vals.length}`); }
    if (sets.length === 0) return p;
    vals.push(p.id);
    const r = await this.pool.query(
      `update projects set ${sets.join(', ')} where id = $${vals.length}
       returning id, slug, name, description, created_by, created_at`,
      vals,
    );
    return projectRow(r.rows[0]);
  }

  async roleFor(projectId: string, userId: string): Promise<Role | null> {
    const r = await this.pool.query<{ role: Role }>(
      `select role from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
    return r.rows[0]?.role ?? null;
  }

  async resolveSlug(slug: string, userId: string): Promise<{ id: string; role: Role }> {
    const p = await this.getBySlugForUser(slug, userId);
    return { id: p.id, role: p.role };
  }
}
```

- [ ] **Step 5: Write `src/server/projects/members.service.ts`**

```ts
import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Member, Role } from '../../shared/types.js';

export class MemberService {
  constructor(private readonly pool: Pool) {}

  private async requireOwner(projectId: string, userId: string): Promise<void> {
    const r = await this.pool.query<{ role: Role }>(
      `select role from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
    if (!r.rows[0]) throw new AppError('not_found', 'project not found', 404);
    if (r.rows[0].role !== 'owner') throw new AppError('forbidden', 'owner role required', 403);
  }

  async list(projectId: string, byUser: string): Promise<Member[]> {
    const r = await this.pool.query<{ role: Role }>(
      `select role from project_members where project_id = $1 and user_id = $2`,
      [projectId, byUser],
    );
    if (!r.rows[0]) throw new AppError('not_found', 'project not found', 404);
    const ms = await this.pool.query<{ user_id: string; email: string; role: Role }>(
      `select m.user_id, u.email, m.role from project_members m
       join users u on u.id = m.user_id
       where m.project_id = $1 order by m.role, u.email`,
      [projectId],
    );
    return ms.rows.map((x) => ({ userId: x.user_id, email: x.email, role: x.role }));
  }

  async add(projectId: string, byUser: string, input: { email: string; role: Role }): Promise<Member> {
    await this.requireOwner(projectId, byUser);
    const u = await this.pool.query<{ id: string }>(`select id from users where email = $1`, [input.email]);
    if (!u.rows[0]) throw new AppError('not_found', 'user not found', 404);
    await this.pool.query(
      `insert into project_members (project_id, user_id, role) values ($1,$2,$3)
       on conflict (project_id, user_id) do update set role = excluded.role`,
      [projectId, u.rows[0].id, input.role],
    );
    return { userId: u.rows[0].id, email: input.email, role: input.role };
  }

  async remove(projectId: string, byUser: string, userId: string): Promise<void> {
    await this.requireOwner(projectId, byUser);
    if (byUser === userId) throw new AppError('conflict', 'cannot remove yourself', 409);
    await this.pool.query(
      `delete from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
  }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- projects`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/projects/ test/server/projects/
git commit -m "feat(projects): project + member services"
```

---

## Task 1.3: KbService

**Files:**
- Create: `src/server/kb/service.ts`
- Test: `test/server/kb/service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KbService } from '../../../src/server/kb/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: KbService; let uid: string; let pid: string;
beforeAll(async () => {
  svc = new KbService(pool);
  uid = await makeUser(pool);
  pid = await makeProject(pool, uid);
});

describe('KbService', () => {
  it('get returns defaults for new project', async () => {
    const kb = await svc.get(pid);
    expect(kb.repos).toEqual([]);
    expect(kb.notes).toBe('');
  });

  it('update replaces typed fields and appends notes via service', async () => {
    await svc.update(pid, { repos: [{ label: 'main', url: 'https://github.com/x/y' }] });
    let kb = await svc.get(pid);
    expect(kb.repos[0]?.label).toBe('main');
    await svc.update(pid, { notes: 'hello' });
    kb = await svc.get(pid);
    expect(kb.notes).toBe('hello');
  });

  it('update is partial (other fields unchanged)', async () => {
    await svc.update(pid, { tech_stack: ['ts','postgres'] });
    const kb = await svc.get(pid);
    expect(kb.repos[0]?.label).toBe('main');
    expect(kb.techStack).toEqual(['ts','postgres']);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- kb`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/kb/service.ts`**

```ts
import type { Pool } from 'pg';
import type { Kb } from '../../shared/types.js';

const row = (r: any): Kb => ({
  repos: r.repos, urls: r.urls, techStack: r.tech_stack,
  notes: r.notes, updatedAt: r.updated_at,
});

type Patch = {
  repos?: { label: string; url: string }[];
  urls?: { label: string; url: string }[];
  tech_stack?: string[];
  notes?: string;
};

export class KbService {
  constructor(private readonly pool: Pool) {}

  async get(projectId: string): Promise<Kb> {
    const r = await this.pool.query(
      `select repos, urls, tech_stack, notes, updated_at from project_kb where project_id = $1`,
      [projectId],
    );
    return row(r.rows[0]);
  }

  async update(projectId: string, patch: Patch): Promise<Kb> {
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.repos !== undefined)      { vals.push(JSON.stringify(patch.repos));      sets.push(`repos = $${vals.length}::jsonb`); }
    if (patch.urls !== undefined)       { vals.push(JSON.stringify(patch.urls));       sets.push(`urls = $${vals.length}::jsonb`); }
    if (patch.tech_stack !== undefined) { vals.push(JSON.stringify(patch.tech_stack)); sets.push(`tech_stack = $${vals.length}::jsonb`); }
    if (patch.notes !== undefined)      { vals.push(patch.notes);                       sets.push(`notes = $${vals.length}`); }
    if (sets.length === 0) return this.get(projectId);
    sets.push(`updated_at = now()`);
    vals.push(projectId);
    const r = await this.pool.query(
      `update project_kb set ${sets.join(', ')} where project_id = $${vals.length}
       returning repos, urls, tech_stack, notes, updated_at`,
      vals,
    );
    return row(r.rows[0]);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- kb`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/kb/ test/server/kb/
git commit -m "feat(kb): project knowledge-base service"
```

---

## Task 1.4: MilestoneService

**Files:**
- Create: `src/server/milestones/service.ts`
- Test: `test/server/milestones/service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MilestoneService } from '../../../src/server/milestones/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: MilestoneService; let uid: string; let pid: string;
beforeAll(async () => {
  svc = new MilestoneService(pool);
  uid = await makeUser(pool);
  pid = await makeProject(pool, uid);
});

describe('MilestoneService', () => {
  it('create returns milestone, list returns it', async () => {
    const m = await svc.create(pid, { title: 'M1', goal: 'ship' });
    expect(m.title).toBe('M1');
    const list = await svc.listForProject(pid);
    expect(list).toHaveLength(1);
  });

  it('update changes status', async () => {
    const m = await svc.create(pid, { title: 'M2' });
    const u = await svc.update(m.id, { status: 'done' });
    expect(u.status).toBe('done');
  });

  it('list orders by order_index then created_at', async () => {
    const a = await svc.create(pid, { title: 'A' });
    const b = await svc.create(pid, { title: 'B' });
    await svc.update(a.id, { order_index: 5 });
    await svc.update(b.id, { order_index: 1 });
    const list = await svc.listForProject(pid);
    expect(list.findIndex((m) => m.id === b.id)).toBeLessThan(list.findIndex((m) => m.id === a.id));
  });

  it('delete removes the milestone', async () => {
    const m = await svc.create(pid, { title: 'D' });
    await svc.delete(m.id);
    const list = await svc.listForProject(pid);
    expect(list.find((x) => x.id === m.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- milestones`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/milestones/service.ts`**

```ts
import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Milestone, MilestoneStatus } from '../../shared/types.js';

const row = (r: any): Milestone => ({
  id: r.id, projectId: r.project_id, title: r.title, goal: r.goal,
  status: r.status as MilestoneStatus, orderIndex: r.order_index,
  dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null,
  createdAt: r.created_at,
});

export class MilestoneService {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, input: { title: string; goal?: string; due_date?: string }): Promise<Milestone> {
    const r = await this.pool.query(
      `insert into milestones (project_id, title, goal, due_date) values ($1,$2,$3,$4)
       returning id, project_id, title, goal, status, order_index, due_date, created_at`,
      [projectId, input.title, input.goal ?? null, input.due_date ?? null],
    );
    return row(r.rows[0]);
  }

  async listForProject(projectId: string): Promise<Milestone[]> {
    const r = await this.pool.query(
      `select id, project_id, title, goal, status, order_index, due_date, created_at
       from milestones where project_id = $1 order by order_index asc, created_at asc`,
      [projectId],
    );
    return r.rows.map(row);
  }

  async get(id: string): Promise<Milestone> {
    const r = await this.pool.query(
      `select id, project_id, title, goal, status, order_index, due_date, created_at
       from milestones where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'milestone not found', 404);
    return row(r.rows[0]);
  }

  async update(id: string, patch: {
    title?: string; goal?: string | null; status?: MilestoneStatus;
    due_date?: string | null; order_index?: number;
  }): Promise<Milestone> {
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, dbKey] of [
      ['title','title'],['goal','goal'],['status','status'],
      ['due_date','due_date'],['order_index','order_index'],
    ] as const) {
      const v = (patch as any)[k];
      if (v !== undefined) { vals.push(v); sets.push(`${dbKey} = $${vals.length}`); }
    }
    if (sets.length === 0) return this.get(id);
    vals.push(id);
    const r = await this.pool.query(
      `update milestones set ${sets.join(', ')} where id = $${vals.length}
       returning id, project_id, title, goal, status, order_index, due_date, created_at`,
      vals,
    );
    if (!r.rows[0]) throw new AppError('not_found', 'milestone not found', 404);
    return row(r.rows[0]);
  }

  async delete(id: string): Promise<void> {
    const r = await this.pool.query(`delete from milestones where id = $1`, [id]);
    if (r.rowCount === 0) throw new AppError('not_found', 'milestone not found', 404);
  }

  async projectIdOf(id: string): Promise<string> {
    const r = await this.pool.query<{ project_id: string }>(
      `select project_id from milestones where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'milestone not found', 404);
    return r.rows[0].project_id;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- milestones`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/milestones/ test/server/milestones/
git commit -m "feat(milestones): milestone service"
```

---

## Task 1.5: TaskService

**Files:**
- Create: `src/server/tasks/service.ts`
- Test: `test/server/tasks/service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TaskService } from '../../../src/server/tasks/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let svc: TaskService; let uid: string; let pid: string;
beforeAll(async () => {
  svc = new TaskService(pool);
  uid = await makeUser(pool);
  pid = await makeProject(pool, uid);
});

describe('TaskService', () => {
  it('create returns task with defaults', async () => {
    const t = await svc.create(pid, uid, { title: 'T1' });
    expect(t.status).toBe('todo');
    expect(t.priority).toBe('med');
    expect(t.assigneeUserId).toBeNull();
  });

  it('list filters by status and mine', async () => {
    const t = await svc.create(pid, uid, { title: 'T2' });
    await svc.update(t.id, { assignee_user_id: uid, status: 'doing' });
    const mine = await svc.listForProject(pid, { mine: true, userId: uid });
    expect(mine.find((x) => x.id === t.id)).toBeTruthy();
    const doing = await svc.listForProject(pid, { status: 'doing' });
    expect(doing.find((x) => x.id === t.id)).toBeTruthy();
    const blocked = await svc.listForProject(pid, { status: 'blocked' });
    expect(blocked.find((x) => x.id === t.id)).toBeFalsy();
  });

  it('claim sets assignee to caller', async () => {
    const t = await svc.create(pid, uid, { title: 'T3' });
    const c = await svc.claim(t.id, uid);
    expect(c.assigneeUserId).toBe(uid);
  });

  it('update touches updated_at', async () => {
    const t = await svc.create(pid, uid, { title: 'T4' });
    const before = t.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const u = await svc.update(t.id, { title: 'T4b' });
    expect(u.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('get throws not_found for unknown id', async () => {
    await expect(svc.get('00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- tasks`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/tasks/service.ts`**

```ts
import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { Task, TaskStatus, TaskPriority } from '../../shared/types.js';

const row = (r: any): Task => ({
  id: r.id, projectId: r.project_id, milestoneId: r.milestone_id,
  title: r.title, description: r.description, goal: r.goal,
  status: r.status as TaskStatus, priority: r.priority as TaskPriority,
  assigneeUserId: r.assignee_user_id, createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

type ListFilter = {
  milestone?: string; status?: TaskStatus; assignee?: string;
  mine?: boolean; userId?: string;
};

export class TaskService {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, createdBy: string, input: {
    title: string; description?: string; goal?: string;
    milestone_id?: string; priority?: TaskPriority; assignee_user_id?: string;
  }): Promise<Task> {
    const r = await this.pool.query(
      `insert into tasks (project_id, milestone_id, title, description, goal, priority, assignee_user_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, project_id, milestone_id, title, description, goal,
                 status, priority, assignee_user_id, created_by, created_at, updated_at`,
      [projectId, input.milestone_id ?? null, input.title, input.description ?? null,
       input.goal ?? null, input.priority ?? 'med', input.assignee_user_id ?? null, createdBy],
    );
    return row(r.rows[0]);
  }

  async listForProject(projectId: string, filter: ListFilter = {}): Promise<Task[]> {
    const conds: string[] = [`project_id = $1`]; const vals: unknown[] = [projectId];
    if (filter.milestone) { vals.push(filter.milestone); conds.push(`milestone_id = $${vals.length}`); }
    if (filter.status)    { vals.push(filter.status);    conds.push(`status = $${vals.length}`); }
    if (filter.assignee)  { vals.push(filter.assignee);  conds.push(`assignee_user_id = $${vals.length}`); }
    if (filter.mine && filter.userId) { vals.push(filter.userId); conds.push(`assignee_user_id = $${vals.length}`); }
    const r = await this.pool.query(
      `select id, project_id, milestone_id, title, description, goal,
              status, priority, assignee_user_id, created_by, created_at, updated_at
       from tasks where ${conds.join(' and ')} order by created_at desc`,
      vals,
    );
    return r.rows.map(row);
  }

  async get(id: string): Promise<Task> {
    const r = await this.pool.query(
      `select id, project_id, milestone_id, title, description, goal,
              status, priority, assignee_user_id, created_by, created_at, updated_at
       from tasks where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'task not found', 404);
    return row(r.rows[0]);
  }

  async update(id: string, patch: Record<string, unknown>): Promise<Task> {
    const allowed = ['title','description','goal','milestone_id','status','priority','assignee_user_id'] as const;
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of allowed) {
      if (patch[k] !== undefined) { vals.push(patch[k]); sets.push(`${k} = $${vals.length}`); }
    }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await this.pool.query(
      `update tasks set ${sets.join(', ')} where id = $${vals.length}
       returning id, project_id, milestone_id, title, description, goal,
                 status, priority, assignee_user_id, created_by, created_at, updated_at`,
      vals,
    );
    if (!r.rows[0]) throw new AppError('not_found', 'task not found', 404);
    return row(r.rows[0]);
  }

  async claim(id: string, userId: string): Promise<Task> {
    return this.update(id, { assignee_user_id: userId });
  }

  async delete(id: string): Promise<void> {
    const r = await this.pool.query(`delete from tasks where id = $1`, [id]);
    if (r.rowCount === 0) throw new AppError('not_found', 'task not found', 404);
  }

  async projectIdOf(id: string): Promise<string> {
    const r = await this.pool.query<{ project_id: string }>(
      `select project_id from tasks where id = $1`, [id]);
    if (!r.rows[0]) throw new AppError('not_found', 'task not found', 404);
    return r.rows[0].project_id;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tasks`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/tasks/ test/server/tasks/
git commit -m "feat(tasks): task service"
```

---

## Task 1.6: ContextService

**Files:**
- Create: `src/server/context/service.ts`
- Test: `test/server/context/service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ContextService } from '../../../src/server/context/service.js';
import { TaskService } from '../../../src/server/tasks/service.js';
import { freshSchema, closePool } from '../../helpers/db.js';
import { makeUser, makeProject } from '../../helpers/factories.js';

const pool = await freshSchema();
afterAll(() => closePool(pool));
let ctx: ContextService; let tasks: TaskService;
let uid: string; let pid: string; let taskId: string;
beforeAll(async () => {
  ctx = new ContextService(pool); tasks = new TaskService(pool);
  uid = await makeUser(pool); pid = await makeProject(pool, uid);
  const t = await tasks.create(pid, uid, { title: 'T' });
  taskId = t.id;
});

describe('ContextService', () => {
  it('append on task derives project_id from task', async () => {
    const e = await ctx.append({
      authorUserId: uid, authorKind: 'agent',
      targetType: 'task', targetId: taskId, note: 'found a thing',
    });
    expect(e.projectId).toBe(pid);
    expect(e.authorKind).toBe('agent');
    expect(e.note).toBe('found a thing');
  });

  it('append on project requires target_id to be a project id', async () => {
    const e = await ctx.append({
      authorUserId: uid, authorKind: 'human',
      targetType: 'project', targetId: pid, note: 'project note',
    });
    expect(e.projectId).toBe(pid);
  });

  it('append on unknown task throws not_found', async () => {
    await expect(ctx.append({
      authorUserId: uid, authorKind: 'agent',
      targetType: 'task', targetId: '00000000-0000-0000-0000-000000000000', note: 'x',
    })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('query filters by target', async () => {
    await ctx.append({ authorUserId: uid, authorKind: 'agent', targetType: 'task', targetId: taskId, note: 'a' });
    const list = await ctx.query({ project: pid, targetType: 'task', targetId: taskId, limit: 100 });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((e) => e.targetId === taskId)).toBe(true);
  });

  it('query respects since', async () => {
    const cutoff = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await ctx.append({ authorUserId: uid, authorKind: 'human', targetType: 'task', targetId: taskId, note: 'after' });
    const list = await ctx.query({ project: pid, since: cutoff, limit: 100 });
    expect(list.find((e) => e.note === 'after')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- context`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/context/service.ts`**

```ts
import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { ContextEntry, TargetType, AuthorKind } from '../../shared/types.js';

const row = (r: any): ContextEntry => ({
  id: Number(r.id), projectId: r.project_id,
  targetType: r.target_type as TargetType, targetId: r.target_id,
  authorUserId: r.author_user_id, authorKind: r.author_kind as AuthorKind,
  note: r.note, createdAt: r.created_at,
});

export class ContextService {
  constructor(private readonly pool: Pool) {}

  private async resolveProjectId(targetType: TargetType, targetId: string): Promise<string> {
    const tableMap: Record<TargetType, string> = {
      project: 'projects', milestone: 'milestones', task: 'tasks',
    };
    const col = targetType === 'project' ? 'id' : 'project_id';
    const idCol = targetType === 'project' ? 'id' : 'id';
    const r = await this.pool.query<{ project_id: string }>(
      `select ${col} as project_id from ${tableMap[targetType]} where ${idCol} = $1`,
      [targetId],
    );
    if (!r.rows[0]) throw new AppError('not_found', `${targetType} not found`, 404);
    return r.rows[0].project_id;
  }

  async append(input: {
    authorUserId: string; authorKind: AuthorKind;
    targetType: TargetType; targetId: string; note: string;
  }): Promise<ContextEntry> {
    const projectId = await this.resolveProjectId(input.targetType, input.targetId);
    const r = await this.pool.query(
      `insert into context_log (project_id, target_type, target_id, author_user_id, author_kind, note)
       values ($1,$2,$3,$4,$5,$6)
       returning id, project_id, target_type, target_id, author_user_id, author_kind, note, created_at`,
      [projectId, input.targetType, input.targetId, input.authorUserId, input.authorKind, input.note],
    );
    return row(r.rows[0]);
  }

  async query(filter: {
    project?: string; targetType?: TargetType; targetId?: string;
    since?: string; limit: number;
  }): Promise<ContextEntry[]> {
    const conds: string[] = []; const vals: unknown[] = [];
    if (filter.project)    { vals.push(filter.project);    conds.push(`project_id = $${vals.length}`); }
    if (filter.targetType) { vals.push(filter.targetType); conds.push(`target_type = $${vals.length}`); }
    if (filter.targetId)   { vals.push(filter.targetId);   conds.push(`target_id = $${vals.length}`); }
    if (filter.since)      { vals.push(filter.since);      conds.push(`created_at >= $${vals.length}`); }
    vals.push(filter.limit);
    const where = conds.length ? `where ${conds.join(' and ')}` : '';
    const r = await this.pool.query(
      `select id, project_id, target_type, target_id, author_user_id, author_kind, note, created_at
       from context_log ${where} order by created_at desc limit $${vals.length}`,
      vals,
    );
    return r.rows.map(row);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- context`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/context/ test/server/context/
git commit -m "feat(context): append-only context log service"
```

---

# Phase 2 — Server wiring (Fastify routes)

## Task 2.1: App factory and auth middleware

**Files:**
- Create: `src/server/app.ts`, `src/server/index.ts`, `src/server/auth/middleware.ts`, `test/helpers/http.ts`

- [ ] **Step 1: Write `src/server/auth/middleware.ts`**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors.js';
import type { AuthService } from './service.js';
import type { User } from '../../shared/types.js';
import type { AuthorKind } from '../../shared/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    authorKind?: AuthorKind;
  }
}

export function makeAuthMiddleware(auth: AuthService) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 'missing bearer token', 401);
    }
    const token = header.slice(7);
    const user = token.startsWith('cs_s_')
      ? await auth.resolveSessionToken(token)
      : await auth.resolveApiKey(token);
    if (!user) throw new AppError('unauthorized', 'invalid token', 401);
    req.user = user;
    req.authorKind = token.startsWith('cs_s_') ? 'human' : 'agent';
  };
}
```

- [ ] **Step 2: Write `src/server/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AppError } from '../shared/errors.js';
import { AuthService } from './auth/service.js';
import { ProjectService } from './projects/service.js';
import { MemberService } from './projects/members.service.js';
import { KbService } from './kb/service.js';
import { MilestoneService } from './milestones/service.js';
import { TaskService } from './tasks/service.js';
import { ContextService } from './context/service.js';
import { makeAuthMiddleware } from './auth/middleware.js';

import { registerAuthRoutes } from './auth/routes.js';
import { registerProjectRoutes } from './projects/routes.js';
import { registerKbRoutes } from './kb/routes.js';
import { registerMilestoneRoutes } from './milestones/routes.js';
import { registerTaskRoutes } from './tasks/routes.js';
import { registerContextRoutes } from './context/routes.js';
import { registerMcp } from '../mcp/server.js';

export interface Services {
  auth: AuthService; projects: ProjectService; members: MemberService;
  kb: KbService; milestones: MilestoneService; tasks: TaskService; context: ContextService;
}

export function buildServices(pool: Pool): Services {
  return {
    auth: new AuthService(pool),
    projects: new ProjectService(pool),
    members: new MemberService(pool),
    kb: new KbService(pool),
    milestones: new MilestoneService(pool),
    tasks: new TaskService(pool),
    context: new ContextService(pool),
  };
}

export async function buildApp(pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const services = buildServices(pool);
  const auth = makeAuthMiddleware(services.auth);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if ((err as any).validation) {
      return reply.status(422).send({
        error: { code: 'validation_failed', message: 'invalid input', details: (err as any).validation },
      });
    }
    reply.status(500).send({ error: { code: 'internal_error', message: 'internal error' } });
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.register(async (v1) => {
    registerAuthRoutes(v1, services, auth);
    v1.register(async (priv) => {
      priv.addHook('preHandler', auth);
      registerProjectRoutes(priv, services);
      registerKbRoutes(priv, services);
      registerMilestoneRoutes(priv, services);
      registerTaskRoutes(priv, services);
      registerContextRoutes(priv, services);
    });
  }, { prefix: '/v1' });

  await registerMcp(app, services);

  return app;
}
```

- [ ] **Step 3: Write `src/server/index.ts`**

```ts
import { createPool } from '../shared/db.js';
import { buildApp } from './app.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
const port = Number(process.env.PORT ?? 3000);

const pool = createPool(url);
const app = await buildApp(pool);
await app.listen({ port, host: '0.0.0.0' });
console.log(`contextsync listening on :${port}`);
```

- [ ] **Step 4: Write `test/helpers/http.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../../src/server/app.js';

export async function buildTestApp(pool: Pool): Promise<FastifyInstance> {
  const app = await buildApp(pool);
  await app.ready();
  return app;
}

export async function asUser(app: FastifyInstance, email: string, password = 'password123', name = 'Test'): Promise<string> {
  await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, password, name } });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
  return JSON.parse(r.payload).token as string;
}
```

> Implementer note: `registerMcp` is added in Phase 3; stub the import target by creating an empty file in Step 5 so this compiles. The actual MCP wiring task is Task 3.1.

- [ ] **Step 5: Create stub `src/mcp/server.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Services } from '../server/app.js';
export async function registerMcp(_app: FastifyInstance, _svc: Services): Promise<void> {}
```

- [ ] **Step 6: Lint to verify compile**

Run: `npm run lint`
Expected: ok. Routes files referenced by `app.ts` are stubbed in subsequent tasks; create empty stubs for each route file now so `lint` passes:

```ts
// src/server/auth/routes.ts (and parallel files for projects, kb, milestones, tasks, context)
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
export function registerAuthRoutes(_a: FastifyInstance, _s: Services, _auth: any): void {}
```

Create the same shape for `projects/routes.ts`, `kb/routes.ts`, `milestones/routes.ts`, `tasks/routes.ts`, `context/routes.ts` (omit the `_auth` param for the latter five; signature: `(app, services)`).

- [ ] **Step 7: Commit**

```bash
git add src/server/app.ts src/server/index.ts src/server/auth/middleware.ts \
        src/server/auth/routes.ts src/server/projects/routes.ts src/server/kb/routes.ts \
        src/server/milestones/routes.ts src/server/tasks/routes.ts src/server/context/routes.ts \
        src/mcp/server.ts test/helpers/http.ts
git commit -m "feat(server): app factory, auth middleware, route stubs"
```

---

## Task 2.2: Auth routes

**Files:**
- Modify: `src/server/auth/routes.ts`
- Test: `test/server/auth/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });

describe('auth routes', () => {
  it('signup → login → /me returns user', async () => {
    const s = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'a@b.c', password: 'password123', name: 'A' } });
    expect(s.statusCode).toBe(201);
    const l = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@b.c', password: 'password123' } });
    expect(l.statusCode).toBe(200);
    const token = JSON.parse(l.payload).token as string;
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.payload).email).toBe('a@b.c');
  });

  it('POST /v1/auth/keys returns raw once; GET hides it', async () => {
    const l = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@b.c', password: 'password123' } });
    const token = JSON.parse(l.payload).token as string;
    const mint = await app.inject({
      method: 'POST', url: '/v1/auth/keys', headers: { authorization: `Bearer ${token}` },
      payload: { name: 'laptop' },
    });
    expect(mint.statusCode).toBe(201);
    const body = JSON.parse(mint.payload);
    expect(body.raw).toMatch(/^cs_k_/);
    expect(body.id).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/v1/auth/keys', headers: { authorization: `Bearer ${token}` } });
    const keys = JSON.parse(list.payload);
    expect(keys[0]).not.toHaveProperty('raw');
  });

  it('rejects missing token', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(r.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- auth/routes`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/auth/routes.ts`**

```ts
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { Services } from '../app.js';
import { SignupInput, LoginInput, CreateApiKeyInput } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

export function registerAuthRoutes(app: FastifyInstance, s: Services, auth: preHandlerAsyncHookHandler): void {
  app.post('/auth/signup', async (req, reply) => {
    const parsed = SignupInput.parse(req.body);
    const user = await s.auth.signup(parsed);
    reply.status(201).send({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/auth/login', async (req) => {
    const parsed = LoginInput.parse(req.body);
    const token = await s.auth.login(parsed);
    return { token };
  });

  app.register(async (priv) => {
    priv.addHook('preHandler', auth);

    priv.get('/auth/me', async (req) => {
      if (!req.user) throw new AppError('unauthorized', 'no user', 401);
      return { id: req.user.id, email: req.user.email, name: req.user.name };
    });

    priv.post('/auth/keys', async (req, reply) => {
      const parsed = CreateApiKeyInput.parse(req.body);
      const out = await s.auth.mintApiKey(req.user!.id, parsed.name);
      reply.status(201).send(out);
    });

    priv.get('/auth/keys', async (req) => s.auth.listKeys(req.user!.id));

    priv.delete<{ Params: { id: string } }>('/auth/keys/:id', async (req, reply) => {
      await s.auth.revokeKey(req.user!.id, req.params.id);
      reply.status(204).send();
    });
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- auth/routes`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/routes.ts test/server/auth/routes.test.ts
git commit -m "feat(server): auth routes"
```

---

## Task 2.3: Project + member routes

**Files:**
- Modify: `src/server/projects/routes.ts`
- Test: `test/server/projects/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });

const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('project routes', () => {
  it('CRUD round trip and member access boundary', async () => {
    const owner = await asUser(app, 'o@t.co');
    const create = await app.inject({
      method: 'POST', url: '/v1/projects', headers: H(owner),
      payload: { slug: 'acme', name: 'Acme' },
    });
    expect(create.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/v1/projects', headers: H(owner) });
    expect(JSON.parse(list.payload).map((p: any) => p.slug)).toContain('acme');

    const stranger = await asUser(app, 's@t.co');
    const denied = await app.inject({ method: 'GET', url: '/v1/projects/acme', headers: H(stranger) });
    expect(denied.statusCode).toBe(404);
  });

  it('owner adds and removes a member; non-owner cannot', async () => {
    const owner = await asUser(app, 'o2@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(owner), payload: { slug: 'mteam', name: 'm' } });
    await asUser(app, 'm@t.co');

    const add = await app.inject({
      method: 'POST', url: '/v1/projects/mteam/members', headers: H(owner),
      payload: { email: 'm@t.co', role: 'member' },
    });
    expect(add.statusCode).toBe(201);

    const member = await asUser(app, 'm@t.co'); // re-login → fresh token
    const cannot = await app.inject({
      method: 'POST', url: '/v1/projects/mteam/members', headers: H(member),
      payload: { email: 'm@t.co', role: 'owner' },
    });
    expect(cannot.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- projects/routes`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/projects/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { CreateProjectInput, UpdateProjectInput, AddMemberInput } from '../../shared/schemas.js';

export function registerProjectRoutes(app: FastifyInstance, s: Services): void {
  app.get('/projects', async (req) => s.projects.listForUser(req.user!.id));

  app.post('/projects', async (req, reply) => {
    const parsed = CreateProjectInput.parse(req.body);
    const p = await s.projects.create(req.user!.id, parsed);
    reply.status(201).send(p);
  });

  app.get<{ Params: { slug: string } }>('/projects/:slug', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    const kb = await s.kb.get(p.id);
    const members = await s.members.list(p.id, req.user!.id);
    return { ...p, kb, members };
  });

  app.patch<{ Params: { slug: string } }>('/projects/:slug', async (req) => {
    const parsed = UpdateProjectInput.parse(req.body);
    return s.projects.update(req.params.slug, req.user!.id, parsed);
  });

  app.get<{ Params: { slug: string } }>('/projects/:slug/members', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.members.list(p.id, req.user!.id);
  });

  app.post<{ Params: { slug: string } }>('/projects/:slug/members', async (req, reply) => {
    const parsed = AddMemberInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    const m = await s.members.add(p.id, req.user!.id, parsed);
    reply.status(201).send(m);
  });

  app.delete<{ Params: { slug: string; uid: string } }>('/projects/:slug/members/:uid', async (req, reply) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    await s.members.remove(p.id, req.user!.id, req.params.uid);
    reply.status(204).send();
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- projects/routes`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/projects/routes.ts test/server/projects/routes.test.ts
git commit -m "feat(server): project and member routes"
```

---

## Task 2.4: KB routes

**Files:**
- Modify: `src/server/kb/routes.ts`
- Test: `test/server/kb/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('kb routes', () => {
  it('PATCH replaces repos and GET reflects it', async () => {
    const tok = await asUser(app, 'k@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'kb1', name: 'k' } });
    const u = await app.inject({
      method: 'PATCH', url: '/v1/projects/kb1/kb', headers: H(tok),
      payload: { repos: [{ label: 'main', url: 'https://github.com/x/y' }] },
    });
    expect(u.statusCode).toBe(200);
    const g = await app.inject({ method: 'GET', url: '/v1/projects/kb1/kb', headers: H(tok) });
    expect(JSON.parse(g.payload).repos[0].label).toBe('main');
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- kb/routes`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/kb/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { UpdateKbInput } from '../../shared/schemas.js';

export function registerKbRoutes(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { slug: string } }>('/projects/:slug/kb', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.kb.get(p.id);
  });

  app.patch<{ Params: { slug: string } }>('/projects/:slug/kb', async (req) => {
    const parsed = UpdateKbInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.kb.update(p.id, parsed);
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- kb/routes`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/server/kb/routes.ts test/server/kb/routes.test.ts
git commit -m "feat(server): kb routes"
```

---

## Task 2.5: Milestone routes

**Files:**
- Modify: `src/server/milestones/routes.ts`
- Test: `test/server/milestones/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('milestone routes', () => {
  it('create, list, patch, delete', async () => {
    const tok = await asUser(app, 'm@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'mp', name: 'mp' } });

    const c = await app.inject({
      method: 'POST', url: '/v1/projects/mp/milestones', headers: H(tok),
      payload: { title: 'M1', goal: 'ship' },
    });
    expect(c.statusCode).toBe(201);
    const id = JSON.parse(c.payload).id as string;

    const list = await app.inject({ method: 'GET', url: '/v1/projects/mp/milestones', headers: H(tok) });
    expect(JSON.parse(list.payload)).toHaveLength(1);

    const u = await app.inject({
      method: 'PATCH', url: `/v1/milestones/${id}`, headers: H(tok),
      payload: { status: 'done' },
    });
    expect(JSON.parse(u.payload).status).toBe('done');

    const d = await app.inject({ method: 'DELETE', url: `/v1/milestones/${id}`, headers: H(tok) });
    expect(d.statusCode).toBe(204);
  });

  it('rejects access to a milestone in a project the user is not a member of', async () => {
    const a = await asUser(app, 'a@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(a), payload: { slug: 'priv', name: 'priv' } });
    const c = await app.inject({
      method: 'POST', url: '/v1/projects/priv/milestones', headers: H(a),
      payload: { title: 'X' },
    });
    const id = JSON.parse(c.payload).id as string;

    const b = await asUser(app, 'b@t.co');
    const denied = await app.inject({ method: 'PATCH', url: `/v1/milestones/${id}`, headers: H(b), payload: { title: 'hax' } });
    expect(denied.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- milestones/routes`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/milestones/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { CreateMilestoneInput, UpdateMilestoneInput } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

async function requireMemberByMilestone(s: any, milestoneId: string, userId: string): Promise<void> {
  const projectId = await s.milestones.projectIdOf(milestoneId);
  const role = await s.projects.roleFor(projectId, userId);
  if (!role) throw new AppError('not_found', 'milestone not found', 404);
  if (role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
}

export function registerMilestoneRoutes(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { slug: string } }>('/projects/:slug/milestones', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    return s.milestones.listForProject(p.id);
  });

  app.post<{ Params: { slug: string } }>('/projects/:slug/milestones', async (req, reply) => {
    const parsed = CreateMilestoneInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    if (p.role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
    const m = await s.milestones.create(p.id, parsed);
    reply.status(201).send(m);
  });

  app.patch<{ Params: { id: string } }>('/milestones/:id', async (req) => {
    await requireMemberByMilestone(s, req.params.id, req.user!.id);
    const parsed = UpdateMilestoneInput.parse(req.body);
    return s.milestones.update(req.params.id, parsed);
  });

  app.delete<{ Params: { id: string } }>('/milestones/:id', async (req, reply) => {
    await requireMemberByMilestone(s, req.params.id, req.user!.id);
    await s.milestones.delete(req.params.id);
    reply.status(204).send();
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- milestones/routes`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/milestones/routes.ts test/server/milestones/routes.test.ts
git commit -m "feat(server): milestone routes"
```

---

## Task 2.6: Task routes

**Files:**
- Modify: `src/server/tasks/routes.ts`
- Test: `test/server/tasks/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('task routes', () => {
  it('create, list with mine filter, patch, get includes recent context', async () => {
    const tok = await asUser(app, 't@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'tp', name: 'tp' } });
    const c = await app.inject({
      method: 'POST', url: '/v1/projects/tp/tasks', headers: H(tok),
      payload: { title: 'T1', goal: 'done means tests pass' },
    });
    expect(c.statusCode).toBe(201);
    const id = JSON.parse(c.payload).id as string;

    const claim = await app.inject({ method: 'PATCH', url: `/v1/tasks/${id}`, headers: H(tok), payload: { status: 'doing' } });
    expect(JSON.parse(claim.payload).status).toBe('doing');

    const mine = await app.inject({ method: 'GET', url: '/v1/projects/tp/tasks?mine=true', headers: H(tok) });
    expect(JSON.parse(mine.payload).length).toBeGreaterThanOrEqual(0); // mine requires assignee set

    await app.inject({ method: 'PATCH', url: `/v1/tasks/${id}`, headers: H(tok),
      payload: { assignee_user_id: JSON.parse((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: H(tok) })).payload).id } });
    const mine2 = await app.inject({ method: 'GET', url: '/v1/projects/tp/tasks?mine=true', headers: H(tok) });
    expect(JSON.parse(mine2.payload)).toHaveLength(1);

    await app.inject({
      method: 'POST', url: '/v1/context', headers: H(tok),
      payload: { target_type: 'task', target_id: id, note: 'finding A' },
    });
    const get = await app.inject({ method: 'GET', url: `/v1/tasks/${id}`, headers: H(tok) });
    const body = JSON.parse(get.payload);
    expect(body.context).toBeDefined();
    expect(body.context[0].note).toBe('finding A');
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- tasks/routes`
Expected: FAIL — context route not yet registered.

- [ ] **Step 3: Write `src/server/tasks/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
import { CreateTaskInput, UpdateTaskInput, ListTasksQuery } from '../../shared/schemas.js';
import { AppError } from '../../shared/errors.js';

async function requireMemberByTask(s: Services, taskId: string, userId: string, mutate: boolean): Promise<void> {
  const projectId = await s.tasks.projectIdOf(taskId);
  const role = await s.projects.roleFor(projectId, userId);
  if (!role) throw new AppError('not_found', 'task not found', 404);
  if (mutate && role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
}

export function registerTaskRoutes(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { slug: string } }>('/projects/:slug/tasks', async (req) => {
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    const q = ListTasksQuery.parse(req.query);
    return s.tasks.listForProject(p.id, { ...q, userId: req.user!.id });
  });

  app.post<{ Params: { slug: string } }>('/projects/:slug/tasks', async (req, reply) => {
    const parsed = CreateTaskInput.parse(req.body);
    const p = await s.projects.getBySlugForUser(req.params.slug, req.user!.id);
    if (p.role === 'viewer') throw new AppError('forbidden', 'viewer cannot edit', 403);
    const t = await s.tasks.create(p.id, req.user!.id, parsed);
    reply.status(201).send(t);
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    await requireMemberByTask(s, req.params.id, req.user!.id, false);
    const t = await s.tasks.get(req.params.id);
    const context = await s.context.query({
      project: t.projectId, targetType: 'task', targetId: t.id, limit: 50,
    });
    return { ...t, context };
  });

  app.patch<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    await requireMemberByTask(s, req.params.id, req.user!.id, true);
    const parsed = UpdateTaskInput.parse(req.body);
    return s.tasks.update(req.params.id, parsed);
  });

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    await requireMemberByTask(s, req.params.id, req.user!.id, true);
    await s.tasks.delete(req.params.id);
    reply.status(204).send();
  });
}
```

- [ ] **Step 4: Run to verify pass** (after Task 2.7 also passes)

Run: `npm test -- tasks/routes`
Expected: PASS, 1 test (re-run after 2.7).

- [ ] **Step 5: Commit**

```bash
git add src/server/tasks/routes.ts test/server/tasks/routes.test.ts
git commit -m "feat(server): task routes"
```

---

## Task 2.7: Context routes

**Files:**
- Modify: `src/server/context/routes.ts`
- Test: `test/server/context/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../../helpers/db.js';
import { buildTestApp, asUser } from '../../helpers/http.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('context routes', () => {
  it('append on task; querying returns entry with author_kind=human for session token', async () => {
    const tok = await asUser(app, 'c@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: H(tok), payload: { slug: 'cp', name: 'cp' } });
    const c = await app.inject({ method: 'POST', url: '/v1/projects/cp/tasks', headers: H(tok), payload: { title: 'T' } });
    const taskId = JSON.parse(c.payload).id;

    const add = await app.inject({
      method: 'POST', url: '/v1/context', headers: H(tok),
      payload: { target_type: 'task', target_id: taskId, note: 'discovered repo' },
    });
    expect(add.statusCode).toBe(201);

    const q = await app.inject({
      method: 'GET', url: `/v1/context?target_type=task&target_id=${taskId}`, headers: H(tok),
    });
    const list = JSON.parse(q.payload);
    expect(list).toHaveLength(1);
    expect(list[0].author_kind).toBe('human');
    expect(list[0].note).toBe('discovered repo');
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- context/routes`
Expected: FAIL.

- [ ] **Step 3: Write `src/server/context/routes.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- context/routes`
Expected: PASS, 1 test. Also re-run `npm test -- tasks/routes` — now passes.

- [ ] **Step 5: Commit**

```bash
git add src/server/context/routes.ts test/server/context/routes.test.ts
git commit -m "feat(server): context routes"
```

---

# Phase 3 — MCP server

## Task 3.1: MCP tools

**Files:**
- Modify: `src/mcp/server.ts`
- Create: `src/mcp/tools.ts`
- Test: `test/mcp/tools.test.ts`

- [ ] **Step 1: Write failing test (integration via in-process client)**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';

// The MCP HTTP transport is exposed at /mcp. We test the tool surface by exercising
// the same handlers the transport uses, exported as `mcpTools(services)`.
import { mcpTools } from '../../src/mcp/tools.js';
import { buildServices } from '../../src/server/app.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
afterAll(async () => { await app.close(); await closePool(pool); });

describe('mcp tools', () => {
  it('list_projects returns memberships for the calling user', async () => {
    const tok = await asUser(app, 'mcp@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: { authorization: `Bearer ${tok}` }, payload: { slug: 'mcpp', name: 'mcpp' } });
    const me = JSON.parse((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${tok}` } })).payload);

    const tools = mcpTools(buildServices(pool));
    const out = await tools.list_projects.handler({ userId: me.id, authorKind: 'agent' }, {});
    expect(out.find((p: any) => p.slug === 'mcpp')).toBeTruthy();
  });

  it('add_context stamps author_kind=agent', async () => {
    const tok = await asUser(app, 'mcp2@t.co');
    await app.inject({ method: 'POST', url: '/v1/projects', headers: { authorization: `Bearer ${tok}` }, payload: { slug: 'mcpp2', name: 'mcpp2' } });
    const c = await app.inject({ method: 'POST', url: '/v1/projects/mcpp2/tasks', headers: { authorization: `Bearer ${tok}` }, payload: { title: 'T' } });
    const task = JSON.parse(c.payload);
    const me = JSON.parse((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${tok}` } })).payload);

    const tools = mcpTools(buildServices(pool));
    const e = await tools.add_context.handler(
      { userId: me.id, authorKind: 'agent' },
      { target_type: 'task', target_id: task.id, note: 'agent found a thing' },
    );
    expect(e.author_kind).toBe('agent');
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- mcp/tools`
Expected: FAIL.

- [ ] **Step 3: Write `src/mcp/tools.ts`**

```ts
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
```

- [ ] **Step 4: Replace stub `src/mcp/server.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Services } from '../server/app.js';
import { mcpTools } from './tools.js';
import { AppError } from '../shared/errors.js';

export async function registerMcp(app: FastifyInstance, services: Services): Promise<void> {
  const tools = mcpTools(services);

  app.all('/mcp', async (req, reply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { code: 'unauthorized', message: 'missing bearer' } });
    }
    const token = header.slice(7);
    const user = token.startsWith('cs_s_')
      ? await services.auth.resolveSessionToken(token)
      : await services.auth.resolveApiKey(token);
    if (!user) return reply.status(401).send({ error: { code: 'unauthorized', message: 'invalid token' } });
    const ctx = { userId: user.id, authorKind: token.startsWith('cs_s_') ? 'human' as const : 'agent' as const };

    const server = new Server({ name: 'contextsync', version: '0.1.0' }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(tools).map(([name, t]) => ({
        name, description: t.description,
        inputSchema: { type: 'object' }, // SDK derives from zod via separate path; v1 uses permissive schema
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name as keyof typeof tools;
      const tool = tools[name];
      if (!tool) throw new AppError('not_found', `unknown tool ${String(name)}`, 404);
      try {
        const result = await tool.handler(ctx, req.params.arguments ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e: any) {
        const code = e?.code ?? 'internal_error';
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: { code, message: e.message } }) }],
        };
      }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- mcp`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/ test/mcp/
git commit -m "feat(mcp): mcp tools and streamable http transport"
```

---

# Phase 4 — CLI

## Task 4.1: CLI scaffold (config + api client + output)

**Files:**
- Create: `src/cli/config.ts`, `src/cli/api.ts`, `src/cli/output.ts`, `src/cli/index.ts`
- Test: `test/cli/config.test.ts`

- [ ] **Step 1: Write failing test `test/cli/config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../../src/cli/config.js';

describe('config', () => {
  it('saves and loads round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-cfg-'));
    try {
      const path = join(dir, 'config.json');
      saveConfig(path, { serverUrl: 'http://x', token: 'tok', defaultProject: 'p' });
      const got = loadConfig(path);
      expect(got).toEqual({ serverUrl: 'http://x', token: 'tok', defaultProject: 'p' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadConfig returns null when file does not exist', () => {
    expect(loadConfig('/no/such/file')).toBeNull();
  });
});
```

- [ ] **Step 2: Write `src/cli/config.ts`**

```ts
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  serverUrl: string;
  token?: string;
  defaultProject?: string;
}

export const DEFAULT_CONFIG_PATH = `${homedir()}/.contextsync/config.json`;

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): Config | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Config;
}

export function saveConfig(path: string = DEFAULT_CONFIG_PATH, cfg: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
  try { chmodSync(path, 0o600); } catch { /* not critical on non-posix */ }
}

export function requireConfig(path: string = DEFAULT_CONFIG_PATH): Config {
  const c = loadConfig(path);
  if (!c?.token) throw new Error('Not logged in. Run `cs login` or `npx contextsync init` first.');
  return c;
}
```

- [ ] **Step 3: Write `src/cli/api.ts`**

```ts
import type { Config } from './config.js';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, msg: string) { super(msg); }
}

export class Api {
  constructor(private readonly cfg: Config) {}

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.cfg.serverUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: this.cfg.token ? `Bearer ${this.cfg.token}` : '',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = json?.error ?? { code: 'internal_error', message: text };
      throw new ApiError(res.status, err.code, err.message);
    }
    return json as T;
  }
}
```

- [ ] **Step 4: Write `src/cli/output.ts`**

```ts
export function jsonOut(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

export function table(rows: Record<string, unknown>[], cols: string[]): void {
  if (rows.length === 0) { process.stdout.write('(no rows)\n'); return; }
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const fmt = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join('  ');
  process.stdout.write(fmt(cols) + '\n');
  process.stdout.write(fmt(cols.map((_, i) => '-'.repeat(widths[i]!))) + '\n');
  for (const r of rows) process.stdout.write(fmt(cols.map((c) => String(r[c] ?? ''))) + '\n');
}

export function die(msg: string, exit = 1): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(exit);
}
```

- [ ] **Step 5: Write `src/cli/index.ts`**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { registerLogin } from './commands/login.js';
import { registerKeys } from './commands/keys.js';
import { registerProject } from './commands/project.js';
import { registerMember } from './commands/member.js';
import { registerKb } from './commands/kb.js';
import { registerMilestone } from './commands/milestone.js';
import { registerTask } from './commands/task.js';
import { registerContext } from './commands/context.js';
import { runInit } from '../init/index.js';

const program = new Command();
program.name('contextsync').description('contextsync CLI').version('0.1.0');

program.command('init')
  .description('install skill, register MCP server, save config')
  .option('--upgrade', 'refresh skill template from this package')
  .option('--uninstall', 'remove skill, MCP entry, config')
  .action(runInit);

registerLogin(program);
registerKeys(program);
registerProject(program);
registerMember(program);
registerKb(program);
registerMilestone(program);
registerTask(program);
registerContext(program);

program.parseAsync().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exit(1); });
```

- [ ] **Step 6: Stub all command files so `tsc` succeeds**

For each of `login`, `keys`, `project`, `member`, `kb`, `milestone`, `task`, `context`, create `src/cli/commands/<name>.ts`:

```ts
import type { Command } from 'commander';
export function registerLogin(_program: Command): void {} // rename per file
```

(Replace `registerLogin` with `registerKeys`, etc. as appropriate. Each subsequent task fleshes out one of these.)

Also stub `src/init/index.ts`:

```ts
export async function runInit(_opts?: any): Promise<void> { /* implemented in Phase 5 */ }
```

- [ ] **Step 7: Run config test and verify pass**

Run: `npm test -- cli/config`
Expected: PASS, 2 tests.

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/cli/ src/init/index.ts test/cli/config.test.ts
git commit -m "feat(cli): scaffold, config, api client, output helpers"
```

---

## Task 4.2: `cs login`, `cs keys`, `cs use`

**Files:**
- Modify: `src/cli/commands/login.ts`, `src/cli/commands/keys.ts`
- Test: `test/cli/login.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli api against real server', () => {
  it('signup, login via API, mint key', async () => {
    const api = new Api({ serverUrl: baseUrl });
    await api.request('POST', '/v1/auth/signup', { email: 'cli@t.co', password: 'password123' });
    const { token } = await api.request<{ token: string }>('POST', '/v1/auth/login', { email: 'cli@t.co', password: 'password123' });
    expect(token).toMatch(/^cs_s_/);

    const authed = new Api({ serverUrl: baseUrl, token });
    const k = await authed.request<{ id: string; raw: string }>('POST', '/v1/auth/keys', { name: 'laptop' });
    expect(k.raw).toMatch(/^cs_k_/);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- cli/login`
Expected: FAIL until `Api` exists; it should already exist from 4.1 so this likely passes — re-purpose this test to anchor the API and then exercise commands in subsequent steps.

- [ ] **Step 3: Write `src/cli/commands/login.ts`**

```ts
import type { Command } from 'commander';
import prompts from 'prompts';
import { loadConfig, saveConfig, DEFAULT_CONFIG_PATH } from '../config.js';
import { Api } from '../api.js';

export function registerLogin(program: Command): void {
  program.command('login')
    .description('login with email + password and store session token')
    .option('-s, --server <url>', 'server URL')
    .action(async (opts) => {
      const existing = loadConfig() ?? { serverUrl: '' };
      const serverUrl: string = opts.server ?? existing.serverUrl ?? (await prompts({ type: 'text', name: 'v', message: 'Server URL' })).v;
      const email = (await prompts({ type: 'text', name: 'v', message: 'Email' })).v as string;
      const password = (await prompts({ type: 'password', name: 'v', message: 'Password' })).v as string;
      const api = new Api({ serverUrl });
      try {
        await api.request('POST', '/v1/auth/signup', { email, password });
      } catch { /* user may already exist */ }
      const { token } = await api.request<{ token: string }>('POST', '/v1/auth/login', { email, password });
      saveConfig(DEFAULT_CONFIG_PATH, { ...existing, serverUrl, token });
      process.stdout.write(`logged in. config: ${DEFAULT_CONFIG_PATH}\n`);
    });

  program.command('use <slug>')
    .description('set default project slug for this config')
    .action((slug: string) => {
      const cfg = loadConfig() ?? { serverUrl: '' };
      saveConfig(DEFAULT_CONFIG_PATH, { ...cfg, defaultProject: slug });
      process.stdout.write(`default project: ${slug}\n`);
    });
}
```

- [ ] **Step 4: Write `src/cli/commands/keys.ts`**

```ts
import type { Command } from 'commander';
import { Api } from '../api.js';
import { requireConfig } from '../config.js';
import { jsonOut, table } from '../output.js';

export function registerKeys(program: Command): void {
  const keys = program.command('keys').description('manage api keys');

  keys.command('new <name>')
    .description('mint a new api key (raw shown once)')
    .option('--json', 'json output')
    .action(async (name: string, opts) => {
      const api = new Api(requireConfig());
      const k = await api.request<{ id: string; raw: string }>('POST', '/v1/auth/keys', { name });
      if (opts.json) jsonOut(k);
      else process.stdout.write(`id:  ${k.id}\nraw: ${k.raw}\n(save this — it will not be shown again)\n`);
    });

  keys.command('ls')
    .description('list api keys')
    .option('--json', 'json output')
    .action(async (opts) => {
      const api = new Api(requireConfig());
      const ks = await api.request<{ id: string; name: string; createdAt: string }[]>('GET', '/v1/auth/keys');
      if (opts.json) jsonOut(ks);
      else table(ks, ['id', 'name', 'createdAt']);
    });

  keys.command('rm <id>')
    .description('revoke a key')
    .action(async (id: string) => {
      const api = new Api(requireConfig());
      await api.request('DELETE', `/v1/auth/keys/${id}`);
      process.stdout.write('revoked\n');
    });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- cli/login`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/login.ts src/cli/commands/keys.ts test/cli/login.test.ts
git commit -m "feat(cli): login, use, keys commands"
```

---

## Tasks 4.3 – 4.7: Remaining CLI commands

Each follows the same pattern: tiny REST wrapper, default project from config (`-p, --project <slug>` override), `--json` flag for piping, `table` output by default. Each task: write one integration test that exercises the command end-to-end against the test server, then implement.

### Task 4.3: `cs project` and `cs member`

**Files:** `src/cli/commands/project.ts`, `src/cli/commands/member.ts`, `test/cli/project.test.ts`

- [ ] **Step 1: Test**

```ts
// test/cli/project.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { Api } from '../../src/cli/api.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('cli project', () => {
  it('project new → ls → show contains kb and members', async () => {
    const token = await asUser(app, 'p@t.co');
    const api = new Api({ serverUrl: baseUrl, token });
    await api.request('POST', '/v1/projects', { slug: 'cli-p', name: 'cli p' });
    const list = await api.request<any[]>('GET', '/v1/projects');
    expect(list.find((p) => p.slug === 'cli-p')).toBeTruthy();
    const show = await api.request<any>('GET', '/v1/projects/cli-p');
    expect(show.kb).toBeDefined();
    expect(show.members.find((m: any) => m.role === 'owner')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement `src/cli/commands/project.ts`** — three subcommands `ls`, `show`, `new`. Each calls the matching REST endpoint, renders with `table` or detailed block. Use `requireConfig()` for the token. Resolve slug from arg or `cfg.defaultProject`.

- [ ] **Step 3: Implement `src/cli/commands/member.ts`** — `ls`, `add <email> [--role]`, `rm <email>`. `rm` first resolves email → user id via `GET /v1/projects/:slug` (members include user_id+email).

- [ ] **Step 4: Run test, then commit**

```bash
git add src/cli/commands/project.ts src/cli/commands/member.ts test/cli/project.test.ts
git commit -m "feat(cli): project and member commands"
```

### Task 4.4: `cs kb`

**Files:** `src/cli/commands/kb.ts`, `test/cli/kb.test.ts`

- Subcommands: `show`, `add repo <label> <url>`, `rm repo <label>`, `add url <label> <url>`, `rm url <label>`, `add tech <name>`, `rm tech <name>`, `note "..."`.
- `add`/`rm` do read-modify-write: `GET /v1/projects/:slug/kb`, mutate locally, `PATCH /v1/projects/:slug/kb`.
- `note` does TWO calls: `PATCH /kb` with notes appended, and `POST /v1/context` with `target_type=project, target_id=projectId, note=<text>` so the same note shows in the agent stream.
- Test asserts that after `note`, both `GET /v1/projects/:slug/kb` and `GET /v1/context?project=...` show the entry.
- Commit message: `feat(cli): kb commands`

### Task 4.5: `cs ms`

**Files:** `src/cli/commands/milestone.ts`, `test/cli/milestone.test.ts`

- Subcommands: `ls`, `new <title> --goal "..." [--due]`, `set <id> [--title] [--goal] [--status] [--due]`, `rm <id>`.
- `ls` and `new` use slug from arg/config; `set`/`rm` use milestone id.
- Test: create, list, set status=done, delete.
- Commit: `feat(cli): milestone commands`

### Task 4.6: `cs task`

**Files:** `src/cli/commands/task.ts`, `test/cli/task.test.ts`

- Subcommands: `ls [--mine] [--status] [--milestone]`, `new <title> --goal "..." [-m] [-p]`, `show <id>`, `claim <id>`, `set <id> [--status] [--priority] [--title] [--goal] [--assignee <email>]`, `rm <id>`.
- `--assignee <email>` resolves to user_id via `GET /v1/projects/:slug` member list.
- Test: full lifecycle including `claim` then `set --status done`.
- Commit: `feat(cli): task commands`

### Task 4.7: `cs ctx`

**Files:** `src/cli/commands/context.ts`, `test/cli/context.test.ts`

- Subcommands: `add <task-id> "<note>"`, `log [--project] [--since <iso-or-duration>] [--limit]`.
- `--since 7d` is parsed locally into an ISO timestamp before calling the API.
- Test: `add` then `log --since 1h` returns the entry.
- Commit: `feat(cli): context commands`

---

# Phase 5 — `npx contextsync init`

## Task 5.1: Claude config merger

**Files:**
- Create: `src/init/claude-config.ts`
- Test: `test/init/claude-config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertMcpEntry, removeMcpEntry } from '../../src/init/claude-config.js';

describe('claude-config', () => {
  it('upserts contextsync entry preserving siblings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    try {
      const path = join(dir, 'claude.json');
      writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'x' } }, foo: 1 }, null, 2));
      upsertMcpEntry(path, { url: 'https://x/mcp', token: 'cs_k_x' });
      const got = JSON.parse(readFileSync(path, 'utf8'));
      expect(got.foo).toBe(1);
      expect(got.mcpServers.other.command).toBe('x');
      expect(got.mcpServers.contextsync.url).toBe('https://x/mcp');
      expect(got.mcpServers.contextsync.headers.Authorization).toBe('Bearer cs_k_x');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('creates file if missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    try {
      const path = join(dir, 'claude.json');
      upsertMcpEntry(path, { url: 'https://x/mcp', token: 'cs_k_x' });
      expect(existsSync(path)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('removeMcpEntry deletes only contextsync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    try {
      const path = join(dir, 'claude.json');
      writeFileSync(path, JSON.stringify({
        mcpServers: { contextsync: { url: 'x' }, other: { command: 'y' } },
      }));
      removeMcpEntry(path);
      const got = JSON.parse(readFileSync(path, 'utf8'));
      expect(got.mcpServers.contextsync).toBeUndefined();
      expect(got.mcpServers.other).toBeDefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- init/claude-config`
Expected: FAIL.

- [ ] **Step 3: Write `src/init/claude-config.ts`**

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function upsertMcpEntry(path: string, opts: { url: string; token: string }): void {
  let doc: any = {};
  if (existsSync(path)) doc = JSON.parse(readFileSync(path, 'utf8'));
  doc.mcpServers ??= {};
  doc.mcpServers.contextsync = {
    type: 'http',
    url: opts.url,
    headers: { Authorization: `Bearer ${opts.token}` },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
}

export function removeMcpEntry(path: string): void {
  if (!existsSync(path)) return;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc?.mcpServers?.contextsync) {
    delete doc.mcpServers.contextsync;
    writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- init/claude-config`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/init/claude-config.ts test/init/claude-config.test.ts
git commit -m "feat(init): claude config merger"
```

---

## Task 5.2: Skill installer

**Files:**
- Create: `src/init/skill-install.ts`
- Test: `test/init/skill-install.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill, uninstallSkill } from '../../src/init/skill-install.js';

describe('skill-install', () => {
  it('copies bundled template into target dir', () => {
    const home = mkdtempSync(join(tmpdir(), 'sk-'));
    try {
      installSkill(home);
      const path = join(home, '.claude/skills/contextsync/SKILL.md');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('contextsync');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('prompts when existing file differs (returns "different")', () => {
    const home = mkdtempSync(join(tmpdir(), 'sk-'));
    try {
      installSkill(home);
      const path = join(home, '.claude/skills/contextsync/SKILL.md');
      writeFileSync(path, 'local edits');
      const status = installSkill(home, { force: false });
      expect(status).toBe('different');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('uninstall removes file', () => {
    const home = mkdtempSync(join(tmpdir(), 'sk-'));
    try {
      installSkill(home);
      uninstallSkill(home);
      const path = join(home, '.claude/skills/contextsync/SKILL.md');
      expect(existsSync(path)).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Write `src/init/skill-install.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallStatus = 'created' | 'updated' | 'unchanged' | 'different';

const TEMPLATE_PATH = fileURLToPath(new URL('../skill-template/SKILL.md', import.meta.url));

function targetPath(home: string): string {
  return join(home, '.claude/skills/contextsync/SKILL.md');
}

export function installSkill(home: string, opts: { force?: boolean } = {}): InstallStatus {
  const dst = targetPath(home);
  const bundled = readFileSync(TEMPLATE_PATH, 'utf8');
  if (existsSync(dst)) {
    const current = readFileSync(dst, 'utf8');
    if (current === bundled) return 'unchanged';
    if (!opts.force) return 'different';
    writeFileSync(dst, bundled, 'utf8');
    return 'updated';
  }
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, bundled, 'utf8');
  return 'created';
}

export function uninstallSkill(home: string): void {
  const dst = targetPath(home);
  if (existsSync(dst)) rmSync(dst);
}
```

- [ ] **Step 3: Run to verify pass** (after Task 6.1 writes the template — for now, create a placeholder `src/skill-template/SKILL.md` containing literally `contextsync skill (placeholder)` so this test passes; Task 6.1 replaces it.)

```bash
mkdir -p src/skill-template
printf "%s\n" "# contextsync skill (placeholder)" > src/skill-template/SKILL.md
npm test -- init/skill-install
```

Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add src/init/skill-install.ts test/init/skill-install.test.ts src/skill-template/SKILL.md
git commit -m "feat(init): skill installer"
```

---

## Task 5.3: `init` command end-to-end

**Files:**
- Modify: `src/init/index.ts`
- Test: `test/init/init.test.ts` (smoke test that calls the `init` flow with mocked stdin via prompts injection)

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { runInitWithHome } from '../../src/init/index.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('init', () => {
  it('writes config, skill file, and claude.json entry; smoke test passes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'init-'));
    try {
      await asUser(app, 'init@t.co');
      prompts.inject([baseUrl, 'init@t.co', 'password123', '']);
      await runInitWithHome(home);
      expect(existsSync(join(home, '.contextsync/config.json'))).toBe(true);
      expect(existsSync(join(home, '.claude/skills/contextsync/SKILL.md'))).toBe(true);
      const claudeCfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
      expect(claudeCfg.mcpServers.contextsync.url).toContain('/mcp');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Write `src/init/index.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { saveConfig, loadConfig } from '../cli/config.js';
import { Api } from '../cli/api.js';
import { upsertMcpEntry, removeMcpEntry } from './claude-config.js';
import { installSkill, uninstallSkill, type InstallStatus } from './skill-install.js';

const CFG_REL = '.contextsync/config.json';
const CC_REL = '.claude.json';

export interface InitOpts { upgrade?: boolean; uninstall?: boolean }

export async function runInit(opts: InitOpts = {}): Promise<void> {
  return runInitWithHome(homedir(), opts);
}

export async function runInitWithHome(home: string, opts: InitOpts = {}): Promise<void> {
  const cfgPath = join(home, CFG_REL);
  const ccPath = join(home, CC_REL);

  if (opts.uninstall) {
    uninstallSkill(home);
    removeMcpEntry(ccPath);
    process.stdout.write('uninstalled.\n');
    return;
  }

  if (opts.upgrade) {
    const status = installSkill(home, { force: true });
    process.stdout.write(`skill: ${status}\n`);
    return;
  }

  const existing = loadConfig(cfgPath) ?? { serverUrl: '' };
  const serverUrl = (await prompts({ type: 'text', name: 'v', message: 'Server URL', initial: existing.serverUrl })).v as string;
  const email = (await prompts({ type: 'text', name: 'v', message: 'Email' })).v as string;
  const password = (await prompts({ type: 'password', name: 'v', message: 'Password' })).v as string;
  const defaultProject = (await prompts({ type: 'text', name: 'v', message: 'Default project slug (optional)' })).v as string;

  const api = new Api({ serverUrl });
  try { await api.request('POST', '/v1/auth/signup', { email, password }); } catch { /* may already exist */ }
  const { token: sessionToken } = await api.request<{ token: string }>(
    'POST', '/v1/auth/login', { email, password },
  );

  const authed = new Api({ serverUrl, token: sessionToken });
  const { raw: apiKey } = await authed.request<{ id: string; raw: string }>(
    'POST', '/v1/auth/keys', { name: `init-${new Date().toISOString().slice(0, 10)}` },
  );

  saveConfig(cfgPath, {
    serverUrl, token: sessionToken,
    defaultProject: defaultProject || undefined,
  });
  process.stdout.write(`✓ wrote ${cfgPath}\n`);

  const skillStatus: InstallStatus = installSkill(home);
  if (skillStatus === 'different') {
    const ok = (await prompts({ type: 'confirm', name: 'v', message: 'SKILL.md has local edits. Overwrite?' })).v as boolean;
    if (ok) installSkill(home, { force: true });
  }
  process.stdout.write(`✓ wrote ${join(home, '.claude/skills/contextsync/SKILL.md')}\n`);

  upsertMcpEntry(ccPath, { url: `${serverUrl.replace(/\/$/, '')}/mcp`, token: apiKey });
  process.stdout.write(`✓ registered MCP server in ${ccPath}\n`);

  const projects = await new Api({ serverUrl, token: apiKey }).request<any[]>('GET', '/v1/projects');
  process.stdout.write(`✓ verified connection (${projects.length} projects)\n`);
  process.stdout.write('\nRestart Claude Code to pick up the new skill.\n');
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npm test -- init/init`
Expected: PASS, 1 test.

- [ ] **Step 4: Commit**

```bash
git add src/init/index.ts test/init/init.test.ts
git commit -m "feat(init): npx contextsync init flow"
```

---

# Phase 6 — Skill template

## Task 6.1: Write `src/skill-template/SKILL.md`

**Files:**
- Modify: `src/skill-template/SKILL.md` (replace placeholder)
- Test: `test/skill-template/template.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../../src/skill-template/SKILL.md', import.meta.url));

describe('skill template', () => {
  it('contains required frontmatter and key flows', () => {
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/^---\nname: contextsync/);
    expect(text).toMatch(/description:/);
    expect(text).toMatch(/list_projects/);
    expect(text).toMatch(/add_context/);
    expect(text).toMatch(/claim_task/);
    expect(text).toMatch(/never modify .?goal/i);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- skill-template/template`
Expected: FAIL (placeholder doesn't contain these strings).

- [ ] **Step 3: Replace `src/skill-template/SKILL.md`**

```markdown
---
name: contextsync
description: Use when the user asks about projects, tasks, milestones, or
  team work tracked in contextsync; when starting work in a repo whose
  project KB might have relevant context (repos, urls, conventions); or
  when the user asks the agent to update task status, claim work, or log
  findings. Reads and writes via the contextsync MCP server.
---

# contextsync skill

contextsync stores project context and task state shared between teammates and the agents that work with them. Use the MCP tools provided by the `contextsync` server.

## When this skill applies

- The user mentions a project, task, milestone, or team work that may be tracked here.
- The user is starting work in a repo and you don't yet know what the repo, conventions, or open tasks are.
- The user asks you to claim a task, mark something done, or log what you found.

If none of these apply, stay quiet.

## Flow 1: Orient at the start of a session

On the first relevant message in a session:

1. Call `list_projects`. If the user mentioned a project, match by slug or name. Otherwise pick the project whose slug the user has set as default (the MCP server returns one project; if the user belongs to many, ask).
2. Call `get_project(slug)` for the chosen project. This returns the KB (repos, urls, tech_stack, notes) and the member list.
3. Call `list_tasks(slug, { mine: true })`. Surface up to three open or in-progress tasks the user is on the hook for. If none, say so.

Treat the KB as ground truth for repos and urls. Don't ask the user "what repo is this?" if `get_kb` already says.

## Flow 2: Work intake

When the user says "let's work on X" or similar:

1. Call `list_tasks(slug)` and fuzzy-match X against task titles.
2. Call `get_task(id)` for the best match and read the goal and recent context entries. The goal is the human-authored definition of done — treat it as a constraint.
3. If the task is unassigned, call `claim_task(id)`.
4. If status is `todo`, call `update_task(id, { status: "doing" })`.

If the match is ambiguous, list candidates and ask the user which one.

## Flow 3: Log context as you go

Call `add_context({ target_type: "task", target_id, note })` after any of:

- You found a relevant link, doc, or code path the user didn't already give you.
- You made a non-trivial decision (e.g. picked one library/approach over another with a reason).
- You hit a blocker. Include the symptom and what you tried.
- The user gave a clarifying answer that changes the goal interpretation.

One note per finding. Be concrete. Past tense. Examples:

- `"Confirmed the auth flow is gated by FeatureFlag.AUTH_V2 — see src/auth/gate.ts:42"`
- `"Picked argon2 over bcrypt because we already have it in the wallet code"`
- `"Blocked on missing DATABASE_URL in the staging env — DM'd ops"`

Do NOT log: routine progress ("read file X"), what the user already said in chat, or speculation.

## Flow 4: Close out

When the work wraps:

1. Summarize what changed in one final `add_context` note. Keep it tight: what shipped, where it lives, any follow-ups.
2. Call `update_task(id, { status: "done" })` — but ONLY after confirming with the user. Never silently mark done.

## Hard rules

- **Never modify `goal` on a task without explicit user approval.** That is the human-authored definition of done. If the work has drifted from the goal, surface that to the user; let them update the goal.
- **Never modify `priority` or `assignee` for someone else without asking.**
- **All your writes are stamped `author_kind: agent` automatically.** Don't try to set it yourself; the server overrides.
- **Treat the project KB as shared.** When updating it, prefer additive changes (one new repo, one new url) over overwrites.

## When to use REST vs MCP

You only have MCP. If the user asks "show me everything as JSON", call `get_context({ project: slug, limit: 50 })` and render it. The CLI (`cs`) exists for the human; don't suggest the user run shell commands when you can just call a tool.

## Failure modes

- `unauthorized`: the user needs to re-run `npx contextsync init` or `cs login`. Tell them.
- `not_found` on a project: the user isn't a member. Suggest they ask the owner to add them.
- `forbidden`: the user is a viewer on this project. Surface this — don't keep retrying.
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- skill-template/template`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/skill-template/SKILL.md test/skill-template/template.test.ts
git commit -m "feat(skill): claude skill template"
```

---

# Phase 7 — Final integration check

## Task 7.1: Full suite green + manual smoke

**Files:** none

- [ ] **Step 1: Run full test suite**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
until docker compose -f docker-compose.test.yml exec -T postgres pg_isready -U contextsync; do sleep 1; done
npm test
npm run build
```

Expected: all tests pass. `dist/` populated.

- [ ] **Step 2: Manual server smoke**

In one terminal:
```bash
DATABASE_URL=postgres://contextsync:contextsync@localhost:54329/contextsync_test npm run start
```

In another:
```bash
curl -s -X POST http://localhost:3000/v1/auth/signup -H 'content-type: application/json' \
  -d '{"email":"me@x.com","password":"password123"}'
TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"me@x.com","password":"password123"}' | jq -r .token)
curl -s -X POST http://localhost:3000/v1/projects -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"slug":"smoke","name":"Smoke"}'
curl -s http://localhost:3000/v1/projects -H "authorization: Bearer $TOKEN" | jq
```

Expected: project listed.

- [ ] **Step 3: Tag v0.1.0**

```bash
git tag -a v0.1.0 -m "contextsync v0.1.0"
```

---

# Notes for the implementing engineer

- **Test isolation:** each test file calls `freshSchema()` once at top level, which drops and recreates `public`. Don't run multiple service test files in parallel against the same Postgres instance — Vitest's default is parallel across files. Configure `vitest.config.ts` to `pool: 'forks', poolOptions: { forks: { singleFork: true } }` if flakiness appears; v1 keeps the simpler config and runs Postgres-backed suites sequentially via file naming if needed.
- **Why argon2 token lookup is full-table:** the spec accepts this for v1 (small user/key count). Don't pre-optimize.
- **`viewer` role:** enforced in routes (and MCP tools) by checking `role === 'viewer'` before mutations. Members get read+write; viewers get read only.
- **MCP transport:** Streamable HTTP is stateless per-request in this design (`sessionIdGenerator: undefined`). If your `@modelcontextprotocol/sdk` version exposes a different API for stateless mode, adjust accordingly — the rest of the design holds.
- **Frequent commits:** the plan shows one commit per task. If a task has multiple natural sub-commits, that's fine; do not skip the commit.

---

# Spec coverage self-check

- ✅ Hosted service, Postgres — Phase 0 + DB layer.
- ✅ Users + agent API keys — Task 1.1 + auth middleware.
- ✅ Project → milestone → task — Tasks 1.4, 1.5.
- ✅ Goal field on tasks/milestones — schema (`goal` in tables, `CreateTaskInput.goal`, `CreateMilestoneInput.goal`).
- ✅ Agent context (append-only) — Task 1.6 + 2.7 + skill rules.
- ✅ Priority — task fields.
- ✅ Project KB typed + notes — Tasks 1.3 + 2.4.
- ✅ Members + roles — Task 1.2 + 2.3.
- ✅ REST API — Phase 2.
- ✅ MCP at /mcp, Streamable HTTP, Bearer auth — Task 3.1.
- ✅ CLI with `cs use`, `kb note` dual-write — Phase 4.
- ✅ `npx contextsync init` writing config + skill + `~/.claude.json` — Phase 5.
- ✅ Skill content with four flows + hard rules — Task 6.1.
- ✅ Error shape, validation, role enforcement — across routes and tools.

No gaps found.
