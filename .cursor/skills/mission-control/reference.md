# Mission Control MCP Reference

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `MISSION_CONTROL_API_URL` | `http://10.10.50.6/api` | Production API (source of truth). Use `http://localhost/api` only for local dev experiments. |

## REST API (underlying)

Same endpoints the MCP wraps:

| Method | Path |
|--------|------|
| GET | `/health` |
| GET | `/overview` |
| GET | `/projects` |
| POST | `/projects` |
| GET | `/projects/:id/board` |
| POST | `/columns/:columnId/tasks` |
| PUT | `/tasks/:id` |
| PATCH | `/tasks/:id/move` |
| DELETE | `/tasks/:id` |

## MCP Tools

### health_check
No parameters. Returns API and database status.

### get_overview
Returns `{ metrics, projects, upcoming, activity }`.

### get_status_report
No parameters. Returns markdown coordination report.

### list_projects
Returns array of `{ id, name, description, color, ... }`.

### get_board
- `project_id` (uuid)

Returns `{ project, board, columns: [{ ..., tasks: [...] }] }`.

### create_project
- `name` (required)
- `description`, `color` (optional)

### create_task
- `project_id`, `column_name`, `title` (required)
- `description`, `priority`, `assignee`, `due_date` (optional)

### update_task
- `task_id` (required)
- any task fields to change

### move_task
- `project_id`, `task_id`, `column_name` (required)
- `position` (optional, default: end of column)

### complete_task
- `project_id`, `task_id` → moves to Done

### delete_task
- `task_id`

## MCP Prompts

### standup_summary
Injects current overview data and asks for a standup write-up.

### coordination_check
- `project_name` (optional) — focus one project or review all

## Setup in Cursor

1. Ensure `.cursor/mcp.json` exists in the repo root.
2. Set `MISSION_CONTROL_API_URL=http://10.10.50.6/api` in `.env` (production = source of truth).
3. Install MCP deps once: `npm install --prefix mcp`
4. Restart Cursor or reload MCP servers in settings.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| MCP tools fail | Run `health_check`; confirm production API is up at `10.10.50.6` |
| Local UI ≠ MCP status | Expected — local Docker has its own DB; MCP reads production |
| Wrong API target | Set `MISSION_CONTROL_API_URL=http://10.10.50.6/api` in `.env` and restart Cursor |
