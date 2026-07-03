# Mission Control MCP Server

stdio MCP server that exposes the Mission Control Dashboard API as Cursor/agent tools.

## Install

```bash
npm install --prefix mcp
```

## Run manually

```bash
MISSION_CONTROL_API_URL=http://localhost/api npm run start --prefix mcp
```

## Cursor setup

Configured in `.cursor/mcp.json` at the repo root. Restart Cursor after install.

## API URL

| Mode | URL |
|------|-----|
| Docker (`docker compose up -d`) | `http://localhost/api` |
| Dev (`npm run dev`) | `http://localhost:3001/api` |

## Authentication

When `JWT_SECRET` is set in `.env`, the API requires auth. Add your `AUTH_API_TOKEN` to `.cursor/mcp.json`:

```json
"env": {
  "MISSION_CONTROL_API_URL": "http://localhost/api",
  "MISSION_CONTROL_API_TOKEN": "<same value as AUTH_API_TOKEN in .env>"
}
```

Restart Cursor after updating. Do not commit real tokens to git.
