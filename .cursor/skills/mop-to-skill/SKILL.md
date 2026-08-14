---
name: mop-to-skill
description: >-
  Convert an ingested Method of Procedure (MOP) from Memoria or local chunk files
  into a draft Cursor Agent Skill for review. Use when the user asks to turn a MOP,
  runbook, or procedure into a skill.
---

# MOP → Cursor skill (draft)

## Workflow

1. Ensure MOP chunks exist locally (`scripts/mop/out/<mop-id>/`) or recall from Memoria and save as markdown.
2. Run:

```bash
node scripts/mop/mop-to-skill.js --from-dir scripts/mop/out/<mop-id>
```

3. Review `.cursor/skills-drafts/mop-<mop-id>/SKILL.md`.
4. Only after user approval, install with `--install` or copy to `~/.cursor/skills/`.

Prefer Memoria recall for latest steps over a stale skill snapshot.
