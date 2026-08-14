---
name: mission-control
description: >-
  Track and update projects/tasks on the production Mission Control Dashboard
  (http://10.10.50.6). Use for project status, standups, Kanban updates, sprint
  progress, creating/moving/completing tasks, Network Equipment board work, or
  whenever shipping features that should be reflected on the dashboard. Production
  is the source of truth — not local Docker.
---

# Mission Control (production source of truth)

Always use **production** Mission Control for project/task tracking:

| | |
|--|--|
| **UI** | http://10.10.50.6 |
| **API** | http://10.10.50.6/api |
| **Auth** | `Authorization: Bearer` with `AUTH_API_TOKEN` or `MISSION_CONTROL_API_TOKEN` from repo `.env` |

Local Docker (`http://localhost`) is a **separate DB** — do **not** use it for status or task mutations unless the user explicitly asks for local-only.

## When to update the board (mandatory)

Update production for **every** feature, enhancement, bug fix, or milestone — do **not** wait for the user to ask.

| Event | Board action |
|-------|----------------|
| Start work | Create or move task → **In Progress** |
| Ship / finish | Move → **Done** (or create Done task with what shipped) |
| New idea / follow-up | Add **Backlog** or **To Do** |
| Status / standup ask | Read overview/board and report |

Pick the correct project (e.g. **Network Equipment**, **Mission Control**). If none fits, `create_project` then add tasks.

After mutations, briefly confirm: project + task title + column. Link: http://10.10.50.6.

## How to call the API

### Prefer MCP

Use the **mission-control** MCP tools when the server is healthy (`health_check` first if unsure).

### Fallback: REST (when MCP is error / unavailable)

Load token from the Dashboard repo `.env` (never print secrets). Then call `http://10.10.50.6/api/...` with the bearer token.

Columns: `Backlog` → `To Do` → `In Progress` → `Review` → `Done`.

Optional: `node backend/scripts/seed-network-board.js` (production by default).

## Do not

- Treat local Docker as the tracking source of truth
- Skip board updates after shipping tracked work
- Print tokens from `.env`
- Guess project/task UUIDs
