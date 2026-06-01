# agentcrew

Task manager and context sync for AI agents and the humans operating them.

Project → milestones → tasks, plus a per-project knowledge base (repos, urls, tech stack, notes). Operators read and edit through a CLI or any HTTP client. Agents read and append context through MCP. Append-only context log preserves the history of what every agent has figured out.

## Install the skill (for Claude Code)

```
npx @crewagent/agentcrew init
```

Prompts for your server URL, email/password, and an optional default project, then:

- writes `~/.agentcrew/config.json`
- installs the skill to `~/.claude/skills/agentcrew/SKILL.md`
- registers the `agentcrew` MCP server in `~/.claude.json`
- smoke-tests the connection

Restart Claude Code to pick up the skill.

## CLI

```
ac project new my-project --name "My Project"
ac use my-project

ac kb add repo main https://github.com/me/my-project
ac kb add tech typescript
ac kb note "MVP launches Friday"

ac ms new "Ship v1" --goal "MVP live in prod"
ac task new "Wire up auth" --goal "Email + password login working" -p high
ac task ls --mine
ac task claim <task-id>
ac task set <task-id> --status doing

ac ctx add <task-id> "Picked argon2 over bcrypt — already in deps"
ac ctx log --since 7d
```

`ac` is the short alias for `agentcrew`. Full `agentcrew` binary is also installed.

## Run your own server

```bash
git clone https://github.com/pewpewgogo/agentcrew
cd agentcrew
docker compose -f docker-compose.test.yml up -d
npm install
npm run build
DATABASE_URL=postgres://agentcrew:agentcrew@localhost:54329/agentcrew_test \
  PORT=3000 node dist/server/index.js
```

Server exposes:

- REST: `http://localhost:3000/v1/*` — projects, milestones, tasks, kb, context, auth
- MCP: `http://localhost:3000/mcp` — Streamable HTTP transport, Bearer-auth via API keys

## Concepts

- **Project** has a slug, a knowledge base (repos, urls, tech stack, notes), members with roles (`owner` / `member` / `viewer`), milestones, and tasks.
- **Milestone** groups tasks under a title + goal + optional due date.
- **Task** has a title, description, goal (human-authored definition of done), status (`todo` / `doing` / `done` / `blocked`), priority (`low` / `med` / `high`), and an assignee.
- **Context log** is append-only. Every entry is tagged `human` or `agent` based on whether it came from a session token (REST/CLI) or an API key (MCP). History is preserved — nothing is ever overwritten.

## Auth

Operators sign up with email + password (`ac login`). They mint API keys (`ac keys new`) for agents and paste them into their MCP client config. Every request resolves `api_key → user`, then enforces project membership.

## MCP tools

`list_projects`, `get_project`, `create_project`, `get_kb`, `update_kb`, `list_milestones`, `create_milestone`, `update_milestone`, `list_tasks`, `get_task`, `create_task`, `update_task`, `claim_task`, `add_context`, `get_context`.

## License

MIT.
