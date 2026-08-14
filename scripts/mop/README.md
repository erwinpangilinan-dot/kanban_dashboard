# Method of Procedure (MOP) ingest for Memoria RAG

Procedures are stored as chunked markdown, ingested into Memoria at `http://10.10.50.2:8765`,
and retrieved by agents via `memoria_recall` before procedure-bound work.

Dashboard: **Memoria → Procedures (MOP)** supports paste **or file import**
(`.pdf`, `.doc`, `.docx`, `.md`, `.markdown`, `.txt`). Office/PDF files are
extracted server-side via `POST /api/memoria/procedures/extract` (text-layer PDFs;
scanned image PDFs need OCR first).

## Vault / memory convention

Logical path: `Procedures/<mop_id>/<chunk>.md`

Each chunk memory content includes YAML-style metadata in the body (Memoria `remember` does not accept frontmatter files over HTTP):

```text
[MOP] mop_id=<id> | title=<title> | section=<n>/<total> | <section_title>
Triggers: tag1, tag2
Entities: [[Network Equipment]], [[Mission Control Dashboard]]

## Steps
1. ...
```

### Frontmatter (for local chunk files before ingest)

```yaml
---
type: mop
mop_id: vdu-bmc-redfish-check
title: vDU BMC Redfish health check
task_triggers: [network probe, redfish, bmc]
entities: ["Network Equipment", "Mission Control Dashboard", "Dell iDRAC", "Redfish"]
importance: high
section: 1
section_title: Prerequisites
---
```

### List the entities yourself

Ingest sends `infer_entities: false`, so Memoria does **not** guess entities from a
MOP's prose. It used to, and Title Case headings turned into entities like
`check dry run results triggers` and `review atlas`. Whatever you put in
`entities:` is what gets linked, so name the real systems, vendors, and
components a MOP touches. A MOP with no `entities:` contributes no entity links
at all.

## Scripts

| Script | Purpose |
|--------|---------|
| `chunk-mop.js` | Split a markdown MOP by `##` headings into Procedures files |
| `ingest-mop.js` | POST each chunk to Memoria `/remember` (force + high importance) |
| `mop-to-skill.js` | Build a draft Cursor skill from chunks or recall text |

### Examples

```bash
# Chunk a source MOP
node scripts/mop/chunk-mop.js scripts/mop/samples/vdu-bmc-redfish-check.md --out scripts/mop/out

# Ingest chunks into Memoria
node scripts/mop/ingest-mop.js scripts/mop/out/vdu-bmc-redfish-check

# Generate skill draft (after ingest or from local chunks)
node scripts/mop/mop-to-skill.js --mop-id vdu-bmc-redfish-check --from-dir scripts/mop/out/vdu-bmc-redfish-check
```

Draft skills land in `.cursor/skills-drafts/<mop-id>/`. Approve by copying to `~/.cursor/skills/<mop-id>/`.

## Agent behavior

See skills `mop-compliance` and `mop-to-skill`. Always recall Memoria before following a MOP.
