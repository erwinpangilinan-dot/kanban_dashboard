---
name: memoria
description: >-
  Store and recall personal knowledge via the memoria MCP server.
  Use when starting work that needs prior context, when the user shares
  preferences or facts, when they say remember this, or when answering
  questions about people, projects, or past notes in Memoria.
---

# Memoria

Use the **memoria** MCP server for durable local memory stored in **Memoria** (`vault/`).

## Before non-trivial work

1. `memoria_recall` with a query from the user's request.
2. Use `memoria_entity` when the query is about a specific person or topic.
3. Use matches as context; cite Memoria paths (e.g. `Facts/...`) when helpful.

## When to remember

| Situation | Action |
|-----------|--------|
| User says "remember this" | `memoria_remember` with `importance: high` |
| Durable fact (person, pref, decision) | `memory_type: semantic`, use `[[Entity]]` wikilinks |
| Time-bound (where X is, today's note) | `memory_type: episodic` |
| Small talk, transient debug | Do **not** store |

Salience gate rejects low-value noise. If `stored: false` with `reason: below_threshold`, only retry with `force: true` when the user explicitly wants it kept.

### Wikilinks and entities

- `[[Sarah]]` links a memory to entity `sarah`
- `[[kitchen counter]]` works for places/topics
- Salience keywords (`birthday`, `prefers`, `allergic`, `allergy`, `prefers`, `favorite`, `favourite`, `never forget`, `important`, `deadline`, …) boost storage without `force`

## Workflows

### Recall-first session

```
1. memoria_recall({ query: "<topic from user request>" })
2. If person/topic named → memoria_entity({ name: "<entity>" })
3. Answer using recalled context; cite vault_path when relevant
```

### Store a fact

```
memoria_remember({
  content: "[[Sarah]] prefers tea over coffee",
  memory_type: "semantic",
  importance: "medium"
})
```

Confirm: id, entities, vault_path.

### Health check

```
memoria_status()
```

Use when setup is new or recall returns nothing unexpectedly.

## Tools

| Tool | Use |
|------|-----|
| `memoria_recall` | Multi-signal search (FTS + entities + recency + importance) |
| `memoria_remember` | Store with salience gate (+ markdown file in vault) |
| `memoria_entity` | All memories linked to a person/topic |
| `memoria_status` | Index health, counts, vault/db paths |
| `memoria_graph` | Entity-memory graph for browsing connections |
| `memoria_daily` | Read daily log note (`Memory/Daily/YYYY-MM-DD.md`) |
| `memoria_reindex` | Sync human-edited vault files into SQLite |
| `memoria_consolidate` | Preview/run dedupe + episodic→semantic promotion |

## Vault UX (Phase 4)

- **Episodic** memories append to `Memory/Daily/YYYY-MM-DD.md` and get entity pages under `People/` or `Projects/`
- **`.memoriaignore`** at vault root excludes paths from `memoria_reindex` (see `vault/.memoriaignore.example`)
- **Session hooks** — global `~/.cursor/hooks.json` via `scripts/install-global-cursor.sh`; `sessionStart` auto-recalls into `vault/.memoria/session-context.md`; `sessionEnd` logs daily note
- Run **`memoria_consolidate`** periodically (`dry_run: false` to apply)

## Do not

- Rely on chat history alone — verify with `memoria_recall`.
- Store secrets unless the user explicitly asks.
- Guess entity names — use normalized lowercase (server normalizes for you).
- Commit or push `vault/Facts/` — personal semantic memories stay local (see `.gitignore`).

## Additional resources

- Tool schemas and setup: [reference.md](reference.md)
- Worked examples: [examples.md](examples.md)
