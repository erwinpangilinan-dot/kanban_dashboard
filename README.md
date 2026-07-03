# Mission Control Dashboard

A full-stack Kanban project dashboard for tracking tasks across projects. Built with React, Express, and PostgreSQL.

## Features

- **Overview dashboard** — global metrics, project widgets, deadlines, activity feed (default landing page)
- **Kanban boards** with drag-and-drop task management
- **Multi-project support** with project switcher
- **Task details** — priority, assignee, due dates, descriptions
- **Fully containerized** — one command deploys Postgres + API + UI
- **Dark mode** Mission Control theme

### Metrics definitions

| Metric | Definition |
|--------|------------|
| **Backlog** | Tasks in Backlog or To Do |
| **In Progress** | Tasks in In Progress |
| **Completed** | Tasks in Review or Done |
| **Overdue** | Past due date, not in Review/Done |
| **Done This Week** | Moved to Review/Done in the last 7 days |

---

## Quick Start (Docker — recommended)

Requires Docker only. No local Node.js needed.

```bash
cd kanban_dashboard
docker compose up -d --build
```

Open **http://localhost** — Overview dashboard loads by default.

```bash
docker compose logs -f    # view logs
docker compose down       # stop everything
```

---

## Local Development

Requires Node.js 18+ and Docker (for Postgres only).

```bash
cp .env.example .env
npm run db:up              # starts Postgres on port 5432
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev                # API :3001, UI :5173
```

Open **http://localhost:5173**

For a single-port local setup:

```bash
npm run build && npm start
# Open http://localhost:3001
```

---

## Project Structure

```
kanban_dashboard/
├── backend/              # Express API + Dockerfile
├── frontend/             # React/Vite UI + nginx Dockerfile
├── database/migrations/  # PostgreSQL schema (V1, V2, …)
├── docker-compose.yml    # Full stack: postgres + api + web
└── docker-compose.dev.yml # Dev override (expose Postgres port)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/overview` | Global metrics, project widgets, activity |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id/board` | Kanban board payload |
| POST | `/api/columns/:id/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| PATCH | `/api/tasks/:id/move` | Move/reorder task |
| DELETE | `/api/tasks/:id` | Delete task |

---

## Telegram notifications (Sprint 2)

Set in `.env` to enable push alerts:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...   # from @BotFather
TELEGRAM_CHAT_ID=123456789         # your chat or group id
TELEGRAM_NOTIFY_ON=completed,overdue,urgent
```

| Event | When it fires |
|-------|----------------|
| **completed** | Task moved to Review or Done |
| **urgent** | Task created or updated with urgent priority |
| **overdue** | Daily scan finds past-due tasks not yet notified |

Get your chat ID: message [@userinfobot](https://t.me/userinfobot) or add the bot to a group and use the Telegram API `getUpdates`.

---

## Authentication

Auth is **off by default** (no `JWT_SECRET`). CI and local dev work without credentials.

To enable, set in `.env`:

```bash
JWT_SECRET=change-me-to-a-long-random-string
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secure-password
AUTH_API_TOKEN=token-for-mcp-and-scripts
```

- **Dashboard:** sign-in page appears when auth is enabled
- **MCP / scripts:** send `Authorization: Bearer $AUTH_API_TOKEN`
- **Public routes:** `/api/health`, `/api/auth/status`, `/api/auth/login`

---

## CI/CD

GitHub Actions runs on every push and pull request to `main`:

| Job | Checks |
|-----|--------|
| **test-and-build** | Postgres migrations, API smoke test, frontend typecheck/build, MCP verify |
| **docker** | `docker compose build` for api + web images |

Run the same checks locally (requires Postgres via `npm run db:up`):

```bash
npm run ci
```

---

## Roadmap (confirmed)

| Sprint | Status | Scope |
|--------|--------|-------|
| **Sprint 1** | ✅ Done | Overview + metrics + Docker |
| **Sprint 1b** | ✅ Done | MCP server + Cursor skill for agent coordination |
| **Sprint 2** | In progress | Telegram (Done/overdue/urgent), Email daily digest |
| **Sprint 3** | Planned | GitHub link + auto-create issues |
| **Sprint 4** | Planned | Labels, filters, export |

---

## MCP + Cursor Skill (Agent Coordination)

Agents can read and update project status via the **Mission Control MCP server**.

### Setup

```bash
# 1. Start the dashboard
docker compose up -d

# 2. Install MCP dependencies (once)
npm install --prefix mcp

# 3. Restart Cursor to load .cursor/mcp.json
```

MCP config: `.cursor/mcp.json`  
Skill: `.cursor/skills/mission-control/SKILL.md`

### MCP Tools

| Tool | Purpose |
|------|---------|
| `health_check` | Verify API is up |
| `get_status_report` | Markdown standup/coordination report |
| `get_overview` | Full metrics JSON |
| `list_projects` / `get_board` | Discover projects and tasks |
| `create_task` / `move_task` / `complete_task` | Update work items |
| `create_project` | Add new project |

### Example agent workflow

1. `health_check`
2. `get_status_report` → share standup with team
3. `create_task` → log new work in Backlog
4. `complete_task` → mark finished when done

---

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Enable API auth when set (HS256 JWT) |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Dashboard login credentials |
| `AUTH_API_TOKEN` | Static bearer token for MCP and automation |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram push notifications (Sprint 2) |
| `SMTP_*` / `EMAIL_*` | Daily digest email (Sprint 2) |
| `GITHUB_TOKEN` | GitHub API token (Sprint 3) |

---

## License

ISC
