---
name: agentcrew
description: Use when the user asks about projects, tasks, milestones, or
  team work tracked in agentcrew; when starting work in a repo whose
  project KB might have relevant context (repos, urls, conventions); or
  when the user asks the agent to update task status, claim work, or log
  findings. Reads and writes via the agentcrew MCP server.
---

# agentcrew skill

agentcrew stores project context and task state shared between teammates and the agents that work with them. Use the MCP tools provided by the `agentcrew` server.

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

- `unauthorized`: the user needs to re-run `npx agentcrew init` or `cs login`. Tell them.
- `not_found` on a project: the user isn't a member. Suggest they ask the owner to add them.
- `forbidden`: the user is a viewer on this project. Surface this — don't keep retrying.
