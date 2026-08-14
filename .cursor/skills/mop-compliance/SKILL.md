---
name: mop-compliance
description: >-
  Retrieve and follow Method of Procedure (MOP) documents from Memoria RAG before
  procedure-bound work. Use when the user mentions MOP, method of procedure,
  compliance, change window, runbook steps, or operational tasks that must follow
  a documented procedure (network, BMC/Redfish, deploy, telecom).
---

# MOP compliance (Memoria RAG)

Production Memoria: **http://10.10.50.2:8765** (Cursor MCP `user-memoria`).

## Required before acting

When work may be covered by a MOP:

1. Call `memoria_recall` with the task keywords **and** `MOP` (and `mop_id` if known).
2. Prefer memories whose content starts with `[MOP] mop_id=...`.
3. List the retrieved steps (cite section / vault_path) before executing.
4. Follow steps in order. If something conflicts with ad-hoc instructions, **prefer the MOP** and ask the user.
5. If no MOP is found, say so and proceed carefully (or ask whether to ingest one).

## Ingest new MOPs

- Chunk: `node scripts/mop/chunk-mop.js <file.md>`
- Ingest: `node scripts/mop/ingest-mop.js scripts/mop/out/<mop-id>`
- Or: `.\scripts\mop\sync-mop.ps1 -Source <file.md>`
- Dashboard: Memoria → **Procedures** tab (paste markdown)

Convention: see [`scripts/mop/README.md`](../../../scripts/mop/README.md).

## Convert to skill draft

```bash
node scripts/mop/mop-to-skill.js --from-dir scripts/mop/out/<mop-id>
```

Drafts: `.cursor/skills-drafts/`. Install only after approval.
