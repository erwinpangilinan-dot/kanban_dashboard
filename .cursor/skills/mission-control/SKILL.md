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

Update production for **every** feature, enhancement, bugfix, or milestone — do **not** wait for the user to ask.

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

Load token from the Dashboard repo `.env` (never print secrets). Then:

```text
GET/POST/PUT/PATCH/DELETE  http://10.10.50.6/api/...
Header: Authorization: Bearer <AUTH_API_TOKEN or MISSION_CONTROL_API_TOKEN>
```

Useful routes:

| Action | Method / path |
|--------|----------------|
| List projects | `GET /projects` |
| Board | `GET /projects/:id/board` |
| Create project | `POST /projects` `{ name, description?, color? }` |
| Create task | `POST /columns/:columnId/tasks` `{ title, description?, priority?, ... }` |
| Update task | `PUT /tasks/:id` |
| Move task | `PATCH /tasks/:id/move` `{ column_id, position }` |
| Overview | `GET /overview` |
| Ops | `GET /ops/status` |

Columns (default board): `Backlog` → `To Do` → `In Progress` → `Review` → `Done`.

Resolve column/task IDs via `list_projects` / `get_board` (or REST equivalents) — never guess UUIDs.

Optional helper (idempotent by title):

```bash
node backend/scripts/seed-network-board.js
```

Uses production by default from `.env` (`MISSION_CONTROL_API_URL`).

## MCP tool map

| Tool | Use |
|------|-----|
| `health_check` | Connectivity |
| `get_status_report` / `get_overview` | Standups / metrics |
| `list_projects` / `get_board` | IDs and columns |
| `create_project` / `create_task` | New work |
| `move_task` / `complete_task` | Workflow |
| `update_task` / `delete_task` | Edit / remove |

## Domain terms

| Term | Meaning |
|------|---------|
| Backlog | Columns Backlog + To Do |
| In Progress | Column In Progress |
| Completed | Review + Done |
| Overdue | Past due date, not Review/Done |

## Auth notes

- Production has auth enabled (`JWT_SECRET` set).
- MCP/scripts need `AUTH_API_TOKEN` (same value as on the server); `MISSION_CONTROL_API_TOKEN` defaults to it in `mcp/run.ps1` / `mcp/run.sh`.
- UI login JWT is separate; prefer the API token for agents.
- If API returns 401: fix `.env` token to match production — do not fall back to localhost for tracking.

## Do not

- Treat local Docker as the tracking source of truth
- Skip board updates after shipping tracked work
- Print tokens or passwords from `.env`
- Guess project/task UUIDs

## Additional Resources

- MCP tool schemas: [reference.md](reference.md)
