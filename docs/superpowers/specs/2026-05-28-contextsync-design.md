# contextsync — Design

**Date:** 2026-05-28
**Status:** Approved (brainstorming phase)
**Author:** Vladimir Plotvinov

## Purpose

A simple, hosted tool for sharing project context and task state between teammates and the agents they work with. Project → milestones → tasks, plus a per-project knowledge base (repos, urls, tech stack, free-form notes). Agents read and append context as they work; humans read and edit through a CLI or any HTTP client.

Surfaces:

- **REST API** for any HTTP client.
- **MCP server** for Claude (and any MCP client) on the same host.
- **CLI** (`contextsync` / `cs`) for humans.
- **Skill** for Claude Code, installed via `npx contextsync init`.

## Non-goals

- Replacing Jira/Linear. No sprints, swimlanes, cycles, custom workflows, comments threads, attachments, time tracking.
- Real-time collab/presence. Last-write-wins on edits; append-only on context.
- Self-hostable by every team out of the box. One hosted service is the v1 target.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  contextsync-server (Node 20 + Fastify)                 │
│                                                         │
│   REST  /v1/*  ──┐                                      │
│                  ├──▶  service layer ──▶ Postgres       │
│   MCP   /mcp   ──┘     (projects, tasks, auth, log)     │
└─────────────────────────────────────────────────────────┘
        ▲                  ▲                  ▲
        │ HTTPS+Bearer     │ MCP over HTTP    │ HTTPS+Bearer
        │                  │                  │
   contextsync CLI    Claude skill        Web/agent
   (npx, local)       (via MCP tools)     (any HTTP client)
```

Single Node process. REST and MCP are two routers in the same Fastify app sharing one service layer (`ProjectService`, `MilestoneService`, `TaskService`, `ContextService`, `AuthService`). MCP tools call the service layer directly — no internal HTTP hop.

**Stack:** TypeScript, Node 20+, Fastify, Postgres 15+, `@modelcontextprotocol/sdk` for MCP, `pg` for DB, `argon2` for key hashing, `zod` for validation.

## Data model

Six tables. Postgres.

```sql
users (
  id              uuid pk,
  email           text unique not null,
  name            text,
  password_hash   text,                   -- nullable; OAuth users have none
  created_at      timestamptz default now()
)

api_keys (
  id              uuid pk,
  user_id         uuid references users not null,
  name            text not null,          -- e.g. "my-laptop-claude"
  hash            text not null,          -- argon2(raw_key)
  last_used_at    timestamptz,
  created_at      timestamptz default now()
)

projects (
  id              uuid pk,
  slug            text unique not null,   -- url-safe, immutable
  name            text not null,
  description     text,
  created_by      uuid references users not null,
  created_at      timestamptz default now()
)

project_members (
  project_id      uuid references projects on delete cascade,
  user_id         uuid references users on delete cascade,
  role            text not null check (role in ('owner','member','viewer')),
  primary key (project_id, user_id)
)

project_kb (
  project_id      uuid primary key references projects on delete cascade,
  repos           jsonb not null default '[]',  -- [{label, url}]
  urls            jsonb not null default '[]',  -- [{label, url}]
  tech_stack      jsonb not null default '[]',  -- ["typescript", "postgres"]
  notes           text not null default '',     -- markdown
  updated_at      timestamptz default now()
)

milestones (
  id              uuid pk,
  project_id      uuid references projects on delete cascade not null,
  title           text not null,
  goal            text,
  status          text not null default 'open'  -- open | done
                  check (status in ('open','done')),
  order_index     int not null default 0,
  due_date        date,
  created_at      timestamptz default now()
)

tasks (
  id                  uuid pk,
  project_id          uuid references projects on delete cascade not null,
  milestone_id        uuid references milestones on delete set null,
  title               text not null,
  description         text,
  goal                text,                          -- definition of done
  status              text not null default 'todo'   -- todo|doing|done|blocked
                      check (status in ('todo','doing','done','blocked')),
  priority            text not null default 'med'    -- low|med|high
                      check (priority in ('low','med','high')),
  assignee_user_id    uuid references users on delete set null,
  created_by          uuid references users not null,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
)

context_log (
  id              bigserial pk,
  project_id      uuid references projects on delete cascade not null,
  target_type     text not null check (target_type in ('project','milestone','task')),
  target_id       uuid not null,        -- references whichever table; soft FK
  author_user_id  uuid references users not null,
  author_kind     text not null check (author_kind in ('human','agent')),
  note            text not null,
  created_at      timestamptz default now()
)

-- Indexes
create index on context_log (project_id, created_at desc);
create index on context_log (target_type, target_id, created_at desc);
create index on tasks (project_id, status);
create index on tasks (assignee_user_id, status);
create index on milestones (project_id, order_index);
create index on api_keys (user_id);
```

Key decisions:

- **`context_log` is unified across project/milestone/task.** Discriminated by `target_type`. Cheaper to answer "what happened on project X this week" without three UNIONs.
- **`project_kb` is one row per project** with typed JSONB fields and a markdown `notes` blob.
- **`author_kind`** distinguishes human edits from agent edits — important for humans scanning what their agents did.
- **`api_keys.hash`** is argon2 of the raw key. The raw key is returned only at creation.
- **No tags, no comments table, no due dates on tasks.** Milestones get `due_date`; tasks don't.
- **`target_id` is a soft FK** (no DB-level constraint) so the discriminated union doesn't need three nullable columns. Service layer enforces validity.

## REST API

Versioned at `/v1`. Bearer auth (`Authorization: Bearer <api_key>` or session token) on every endpoint except `POST /v1/auth/login`. JSON in/out. Errors: `{ error: { code, message } }` with codes `unauthorized`, `forbidden`, `not_found`, `conflict`, `validation_failed`.

```
POST   /v1/auth/login                    email+password → session token
POST   /v1/auth/keys                     mint new agent API key (raw returned once)
GET    /v1/auth/keys                     list my keys (metadata only)
DELETE /v1/auth/keys/:id                 revoke

GET    /v1/projects                      list projects I'm a member of
POST   /v1/projects                      create (me = owner)
GET    /v1/projects/:slug                full project incl. kb + member list
PATCH  /v1/projects/:slug                update name/description
POST   /v1/projects/:slug/members        add user (owner only)
DELETE /v1/projects/:slug/members/:uid   remove

GET    /v1/projects/:slug/kb             read kb
PATCH  /v1/projects/:slug/kb             partial update (any subset of fields)

GET    /v1/projects/:slug/milestones     list
POST   /v1/projects/:slug/milestones     create
PATCH  /v1/milestones/:id                update (title, goal, status, due_date, order_index)
DELETE /v1/milestones/:id

GET    /v1/projects/:slug/tasks          ?milestone=&status=&assignee=&mine=
POST   /v1/projects/:slug/tasks          create
GET    /v1/tasks/:id                     single task incl. recent context_log entries
PATCH  /v1/tasks/:id                     update fields
DELETE /v1/tasks/:id

POST   /v1/context                       { target_type, target_id, note } → entry
GET    /v1/context                       ?project=&target_type=&target_id=&since=&limit=
```

Decisions:

- **`PATCH /tasks/:id` does not touch context.** Context is added only through `POST /v1/context`. Keeps the append-only invariant clean and separates "edited the goal" from "agent learned something."
- **Slug-based at the project level, ID-based for tasks/milestones.** Agents pass around stable IDs without re-resolving the project slug.
- **Role enforcement:** `owner` can mutate members + delete project; `member` can mutate tasks/milestones/kb/context; `viewer` is read-only. Every project-scoped request resolves `(api_key → user → project_members)` and rejects non-members with `forbidden`.

## MCP surface

Tools the skill and any MCP client call. Names are verbs; descriptions are tight so the model picks the right one.

```
list_projects()                                  → [{slug, name, role}]
get_project(slug)                                → full project + kb + members
create_project({slug, name, description?})       → project

get_kb(slug)                                     → kb
update_kb(slug, patch)                           → kb  (partial)

list_milestones(slug)                            → [milestone]
create_milestone(slug, {title, goal, due_date?}) → milestone
update_milestone(id, patch)                      → milestone

list_tasks(slug, {milestone?, status?, assignee?, mine?})   → [task]
get_task(id)                                     → task + recent context entries
create_task(slug, {title, goal, description?, milestone?, priority?, assignee?}) → task
update_task(id, patch)                           → task
claim_task(id)                                   → task  (sets assignee = me)

add_context({target_type, target_id, note})      → entry
get_context({project, target_type?, target_id?, since?, limit?}) → [entry]
```

Decisions:

- **`mine: true` on `list_tasks`.** Most common agent question is "what is my human on the hook for?" — a first-class filter, not something to compose.
- **`claim_task` is its own tool** even though `update_task` could do it. Discoverable verb → agents actually use it.
- **No bulk endpoints in v1.** Avoids "agent rewrites half the project in one call." Add later if needed.

Transport: **Streamable HTTP MCP** at `/mcp`. Same Bearer key as REST. The MCP middleware resolves the user once per session and stamps `author_kind = 'agent'` on every write.

## CLI

`contextsync` (alias `cs`). Node binary, distributed via `npm i -g contextsync` or `npx contextsync`. Config at `~/.contextsync/config.json` (chmod 600): server URL, session token, API key, default project slug.

```
cs login                                  # email/password → stores session token
cs keys new <name>                        # mint API key (raw shown once)
cs keys ls
cs keys rm <id>
cs use <project-slug>                     # set default project for this shell

cs project ls
cs project show [slug]
cs project new <slug> --name "..."
cs member ls [slug]
cs member add <email> [--role member|viewer]    # owner-only
cs member rm <email>

cs kb show [slug]
cs kb add repo <label> <url>              # add/replace entry by label
cs kb rm repo <label>
cs kb add url <label> <url>
cs kb rm url <label>
cs kb add tech <name>
cs kb rm tech <name>
cs kb note "..."                          # appends to notes, also logged in context

cs ms ls [slug]
cs ms new <title> --goal "..." [--due YYYY-MM-DD]
cs ms set <id> --status done

cs task ls [--mine] [--status doing] [--milestone <id>]
cs task new <title> --goal "..." [-m <ms-id>] [-p high]
cs task show <id>
cs task claim <id>
cs task set <id> --status doing
cs ctx add <task-id> "..."                # append to context log
cs ctx log [--project ...] [--since 7d]
```

Notes:

- **`cs use`** sets a default project per terminal (`CONTEXTSYNC_PROJECT` env var) so subsequent commands omit the slug.
- **`cs kb note`** appends to `project_kb.notes` **and** writes a `context_log` entry (`target_type=project`) so the note appears in the same stream agents read.
- **Output is human-readable by default, `--json` for piping.**

## Skill — installed via `npx contextsync init`

The npm package ships the CLI binary **and** the skill template. `init` is the supported install path; it also doubles as upgrade and uninstall.

```
$ npx contextsync init
? Server URL:        https://contextsync.example.com
? Paste API key:     ****************
? Default project:   acme-website   (optional)

✓ wrote ~/.contextsync/config.json
✓ wrote ~/.claude/skills/contextsync/SKILL.md
✓ registered MCP server "contextsync" in ~/.claude.json
✓ verified connection (3 projects)

Restart Claude Code to pick up the new skill.
```

`init` does four things:

1. **Config** — writes `~/.contextsync/config.json` (chmod 600).
2. **Skill file** — copies bundled `SKILL.md` to `~/.claude/skills/contextsync/SKILL.md`. Idempotent: overwrites identical files; prompts if the file has local edits.
3. **MCP registration** — merges into `~/.claude.json` under `mcpServers`:
   ```json
   "contextsync": {
     "type": "http",
     "url": "https://contextsync.example.com/mcp",
     "headers": { "Authorization": "Bearer <key>" }
   }
   ```
   Other entries untouched.
4. **Smoke test** — calls `list_projects` over MCP and prints the result.

Sub-commands:

```
npx contextsync init             # first install / safe re-run
npx contextsync init --upgrade   # refresh SKILL.md from current package
npx contextsync init --uninstall # remove skill file + MCP entry + config
```

The skill content covers four flows the agent follows:

1. **Orient.** On first message in a session, call `list_projects` + `get_project` for the active one, then `get_kb` and `list_tasks(mine: true)`. Enter the conversation already knowing the repos, urls, and the user's open work.
2. **Work intake.** When the user says "let's work on X", resolve X to a task via `list_tasks` + fuzzy match → `get_task`. If unassigned, `claim_task`. Set status to `doing`.
3. **Log as you go.** After any non-trivial finding (link discovered, decision made, blocker hit), call `add_context` on the active task. The skill enumerates concrete triggers so the agent neither over-logs nor forgets.
4. **Close out.** When work wraps, summarize what changed into one final `add_context`, then `update_task` status. Never silently mark done — confirm with the user first.

The skill explicitly forbids: **modifying `goal` on a task without asking** — that's the human-authored definition of done.

## Auth flow

- Human signs up via CLI: `cs login` → server creates user if email is new, returns session token (used by CLI only).
- Human mints an agent key: `cs keys new "my-laptop-claude"` → raw key returned once; argon2 hash stored.
- All requests carry `Authorization: Bearer <token>`. Server resolves token → `user`, then enforces `project_members` on every project-scoped action.
- `author_kind` on `context_log` is `agent` if the request arrived via `/mcp`, `human` otherwise. Server stamps this at the transport boundary, not from a client-supplied field.

## Error handling

- All errors: HTTP status + `{ error: { code, message } }`. Codes are stable strings (`unauthorized`, `forbidden`, `not_found`, `conflict`, `validation_failed`, `rate_limited`, `internal_error`).
- Validation via `zod` schemas at the route boundary. Validation errors return 422 with a `details` array of `{ path, message }`.
- MCP tools return the same shape — the SDK serializes errors as `isError: true` content blocks.
- Server logs structured JSON; PII (emails, raw keys) is never logged. API key hashes are not logged either.

## Rate limiting

- Per-API-key: 600 req/min sliding window for reads, 120 req/min for writes. Token bucket in-process (single instance v1; Redis when we scale out).
- 429 with `Retry-After`.

## Testing

- **Unit:** service layer with an in-memory pg (`pg-mem`) for fast tests; one test file per service.
- **Integration:** real Postgres in Docker for the test run. Covers REST routes + MCP tools end-to-end against a fresh schema per suite.
- **Contract test:** every MCP tool has a test that calls it through the MCP transport (not the service layer directly) so transport regressions surface.
- **CLI:** golden-file tests on rendered output for each command, plus one integration test per command against the test server.

## Out of scope for v1

- OAuth providers (email/password only).
- Web UI.
- Webhooks / outbound events.
- Real-time updates (SSE/WebSocket subscriptions to context_log).
- File attachments on tasks.
- Bulk import / export.
- Self-hosted distribution (Helm chart, etc.).

## Repo layout

```
contextsync/
├── package.json                 # one package, two bins
├── tsconfig.json
├── src/
│   ├── server/                  # Fastify app, REST + MCP routers, services
│   ├── mcp/                     # MCP tool definitions, transport setup
│   ├── cli/                     # CLI entrypoint, command handlers, output
│   ├── init/                    # `npx contextsync init` flow
│   ├── shared/                  # types, zod schemas, errors
│   └── skill-template/SKILL.md  # bundled skill file, copied by `init`
├── migrations/                  # SQL migrations (numbered)
├── test/
└── docs/superpowers/specs/
```

`bin` entries in `package.json`:

```json
"bin": {
  "contextsync": "dist/cli/index.js",
  "cs": "dist/cli/index.js"
}
```

`npx contextsync init` works because `init` is a sub-command of the same binary.

## Open questions deferred to implementation

- Exact Postgres migration tool (`node-pg-migrate` vs. raw SQL + custom runner) — decide during plan writing.
- Session token format (JWT vs. opaque + table lookup) — opaque is simpler; revisit if we need stateless auth.
- Whether `update_kb` accepts list-merge semantics ("add this repo if not present") or strict replace. Likely strict replace + a `kb_add_repo` convenience tool if it's awkward in practice.
