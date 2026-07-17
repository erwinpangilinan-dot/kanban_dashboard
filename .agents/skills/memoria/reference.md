# Memoria MCP Reference

## Setup

### Cursor

1. Copy `.cursor/mcp.json.example` → `.cursor/mcp.json` (or merge the `memoria` entry).
2. `npm install --prefix packages/memoria-mcp`
3. Restart Cursor.

### Claude Code

1. `.mcp.json` at repo root is already configured (project scope).
2. `npm install --prefix packages/memoria-mcp`
3. Start a new session; approve the `memoria` server when prompted.

MCP entry: `packages/memoria-mcp/run.sh` (stdio) or `packages/memoria-mcp/run-http.sh` (always-on HTTP).

### Always-on service (recommended)

```bash
./scripts/install-memoria-service.sh
```

Then point Cursor at `http://127.0.0.1:8765/mcp` (see `.cursor/mcp.json.example`). Service auto-starts on boot (systemd user unit + linger).

Health: `curl http://127.0.0.1:8765/health`

## Environment

| Variable | Default |
|----------|---------|
| `MEMORIA_VAULT_PATH` | `<repo>/vault` |
| `MEMORIA_DB_PATH` | `<vault>/.memoria/index.db` |
| `MEMORIA_HTTP_HOST` | `127.0.0.1` |
| `MEMORIA_HTTP_PORT` | `8765` |
| `MEMORIA_HTTP_TOKEN` | optional Bearer token |

`BRAIN_VAULT_PATH` and `BRAIN_DB_PATH` work as aliases.

## MCP Tools

### memoria_remember

Store a memory after salience gating.

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `content` | string | required | Use `[[Entity]]` wikilinks for durable facts |
| `memory_type` | `episodic` \| `semantic` | `semantic` | Episodic → `Episodes/YYYY-MM-DD-*.md` |
| `importance` | `low` \| `medium` \| `high` | `medium` | `high` bypasses gate |
| `force` | boolean | `false` | Bypass salience gate |

**Stored response:** `{ stored: true, id, type, importance, salience_score, entities, vault_path, created_at }`

**Rejected:** `{ stored: false, reason: "below_threshold", salience_score, hint }`

**Duplicate:** `{ stored: false, duplicate: true, existing: { ... } }`

### memoria_recall

Multi-signal search: FTS (45%) + entity match (30%) + recency (15%) + importance (10%).

| Param | Type | Default |
|-------|------|---------|
| `query` | string | required |
| `limit` | int 1–20 | `8` |
| `memory_type` | `episodic` \| `semantic` | all types |

Returns array of `{ id, type, content, importance, vault_path, created_at, score }`.

### memoria_entity

Lookup entity and linked memories (up to 20, newest first).

| Param | Type |
|-------|------|
| `name` | string (normalized to lowercase) |

Returns `{ entity: { id, name, created_at } \| null, memories: [...] }`.

### memoria_status

No parameters. Returns:

```json
{
  "version": "0.4.0",
  "total_memories": 0,
  "total_entities": 0,
  "by_type": { "semantic": 0, "episodic": 0 },
  "last_created_at": null,
  "vault_path": "...",
  "db_path": "..."
}
```

### memoria_graph

No parameters. Returns `{ node_count, edge_count, nodes[], edges[] }`.

- **nodes:** `entity` or `memory` kind, with `label`, optional `vault_path`
- **edges:** `linked` (entity→memory) or `cooccurrence` (entity↔entity in same memory)

### memoria_daily

| Param | Type | Default |
|-------|------|---------|
| `date` | `YYYY-MM-DD` | today |

Returns `{ date, path, content }` — `content` is `null` if the note does not exist.

### memoria_reindex

No parameters. Scans `vault/**/*.md` (skips `.memoria/`, respects `.memoriaignore`), upserts into SQLite.

Returns `{ scanned, added, updated, skipped, indexed_ids, ignored_patterns }`.

### memoria_consolidate

| Param | Type | Default |
|-------|------|---------|
| `dry_run` | boolean | `true` |
| `min_age_days` | int 1–365 | `7` |

Finds duplicate content and aged episodic memories to promote to semantic. Set `dry_run: false` to apply.

## Salience gate (threshold 0.45)

Bypassed when `force: true` or `importance: high`.

| Signal | Score boost |
|--------|-------------|
| `importance: medium` | +0.25 |
| `importance: low` | +0.05 |
| ≥ 6 words | +0.15 |
| Has `[[entity]]` wikilinks | +0.25 |
| `memory_type: semantic` | +0.10 |
| Salience keywords | +0.35 |

Keywords: `birthday`, `anniversary`, `allergic`, `allergy`, `prefers`, `favorite`, `favourite`, `never forget`, `important`, `deadline`.

## Vault layout

```
vault/
├── Episodes/     # time-bound
├── Facts/        # durable
├── People/
├── Projects/
└── Memory/Daily/
```

Each stored memory writes a markdown file with YAML frontmatter (`id`, `type`, `importance`, `created_at`, `entities`).

Episodic memories also append to `Memory/Daily/YYYY-MM-DD.md`. Entities get stub pages in `People/` or `Projects/` with backlinks.

### .memoriaignore

Copy `vault/.memoriaignore.example` → `vault/.memoriaignore`. One glob/prefix per line; used by `memoria_reindex`.

### Conversation hooks (global)

Install once for all Cursor projects:

```bash
./scripts/install-global-cursor.sh
```

`~/.cursor/hooks.json`:

| Event | Script | Effect |
|-------|--------|--------|
| `sessionStart` | `memoria-session-start.sh` | Recalls top memories → `vault/.memoria/session-context.md` + `additional_context` |
| `sessionEnd` | `memoria-session-log.sh` | Appends line to today's daily note |

Global rule `~/.cursor/rules/memoria-session.mdc` tells the agent to read `session-context.md` at chat start (fallback when IDE drops hook context).

Do **not** duplicate these in project `.cursor/hooks.json` when global hooks are installed.

Configure entities: `MEMORIA_SESSION_ENTITIES=erwin pangilinan,memory project`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| MCP tools missing | Restart IDE; verify `.mcp.json` / `.cursor/mcp.json` |
| `below_threshold` on valid fact | Add `[[Entity]]`, salience keyword, or `importance: high` |
| Empty recall | Run `memoria_status`; check `total_memories` |
| Wrong vault | Set `MEMORIA_VAULT_PATH` before starting MCP |
