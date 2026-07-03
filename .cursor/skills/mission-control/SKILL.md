---
name: mission-control
description: >-
  Coordinate project status via the Mission Control Dashboard MCP server.
  Queries overview metrics, Kanban boards, tasks, and activity; creates or moves
  tasks; generates standup reports. Use when the user asks about project status,
  sprint progress, standups, task coordination, Mission Control, kanban board
  updates, overdue tasks, or what is in progress across projects.
---

# Mission Control Coordination

Use the **mission-control** MCP server to read and update the team's Mission Control Dashboard.

## Prerequisites

1. Mission Control stack must be running:
   ```bash
   docker compose up -d
   # or: npm run dev
   ```
2. MCP server is configured in `.cursor/mcp.json` (stdio → `mcp/run.sh`).
3. API default: `http://localhost/api` (Docker). Dev mode: `http://localhost:3001/api`.

Always call `health_check` first if unsure the stack is up.

## Domain Rules

| Term | Meaning |
|------|---------|
| **Backlog** | Columns: Backlog + To Do |
| **In Progress** | Column: In Progress |
| **Completed** | Columns: Review + Done |
| **Overdue** | Past due date, not in Review/Done |

Default columns per project: `Backlog` → `To Do` → `In Progress` → `Review` → `Done`.

## Coordination Workflows

### Status check / standup

```
1. health_check
2. get_status_report          ← markdown summary for humans
   OR get_overview             ← raw JSON for analysis
3. Optionally get_board per project for detail
```

Use prompt `standup_summary` for a pre-filled standup generation request.

### Create work item

```
1. list_projects              ← get project_id if unknown
2. create_task
   - project_id
   - column_name (e.g. "Backlog" or "To Do")
   - title, priority, assignee, due_date
```

### Mark work complete

```
complete_task(project_id, task_id)
```

Or `move_task` to `Review` or `Done`.

### Risk / health review

```
1. get_overview
2. Prompt: coordination_check
   - optional project_name to focus
```

Flag: `overdue > 0`, high `in_progress` with low `completed_this_week`, projects at 0% progress.

## Tool Quick Reference

| Tool | When to use |
|------|-------------|
| `health_check` | Verify API before other calls |
| `get_status_report` | Standups, status updates to user |
| `get_overview` | Metrics + widgets + activity (JSON) |
| `list_projects` | Find project IDs and names |
| `get_board` | Full Kanban for one project |
| `create_task` | Add task by column name |
| `move_task` | Change column / workflow stage |
| `complete_task` | Shortcut → Done |
| `update_task` | Edit title, priority, assignee, due date |
| `delete_task` | Remove task permanently |
| `create_project` | New project + default board |

## Response Guidelines

When reporting status to the user:

1. Lead with **overdue** and **due this week** if any exist.
2. Summarize each **project widget** (name, % complete, active, overdue).
3. List **in progress** items when asked what's being worked on.
4. After mutations, confirm what changed and suggest refreshing the dashboard.

## Do Not

- Guess `project_id` or `task_id` — fetch via `list_projects` / `get_board` first.
- Use column UUIDs with the user — always refer to column **names**.
- Skip `health_check` when the user reports connection errors.

## Additional Resources

- MCP tool schemas: [reference.md](reference.md)
- Dashboard UI: http://localhost (Docker) or http://localhost:5173 (dev)
