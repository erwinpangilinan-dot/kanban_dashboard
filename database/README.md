# Database Schema

PostgreSQL schema for the Mission Control Kanban dashboard.

## Tables

| Table | Purpose |
|-------|---------|
| `projects` | Top-level project containers |
| `boards` | Kanban boards (one default board per project) |
| `columns` | Board columns (Backlog, To Do, In Progress, etc.) |
| `tasks` | Individual task cards with priority, assignee, due date |

## Migrations

- `V1__create_kanban_tables.sql` — Create all tables and indexes
- `U1__drop_kanban_tables.sql` — Rollback

Migrations run automatically when the backend starts.

## Local Development

```bash
docker compose up -d
```

Connection string (default): `postgresql://kanban:kanban@localhost:5432/mission_control`
