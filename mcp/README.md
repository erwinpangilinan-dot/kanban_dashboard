# Mission Control MCP Server

stdio MCP server that exposes the Mission Control Dashboard API as Cursor/agent tools.

**Production is the source of truth.** MCP reads and writes `http://10.10.50.6/api` by default.
Local Docker at `http://localhost` is for development only (separate database).

## Install

```bash
npm install --prefix mcp
```

## Run manually

```bash
MISSION_CONTROL_API_URL=http://localhost/api npm run start --prefix mcp
```

## Cursor setup

Configured in `.cursor/mcp.json` at the repo root. `mcp/run.sh` loads `.env` automatically. Restart Cursor after changing URL or tokens.

## API URL

Set `MISSION_CONTROL_API_URL` in `.env`:

| Target | URL | Use for |
|--------|-----|---------|
| **Production (default)** | `http://10.10.50.6/api` | Status, standups, task updates |
| Docker local (`docker compose up -d`) | `http://localhost/api` | Local dev experiments only |
| Dev (`npm run dev`) | `http://localhost:3001/api` | Local dev experiments only |

Default if unset: `http://10.10.50.6/api`

## Authentication

When `JWT_SECRET` is set in `.env`, the API requires auth. Set `AUTH_API_TOKEN` in `.env` — `mcp/run.sh` maps it to `MISSION_CONTROL_API_TOKEN` automatically.

Do not commit real tokens to git.
