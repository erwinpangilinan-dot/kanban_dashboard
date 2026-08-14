#!/usr/bin/env node
/**
 * Generate a draft Cursor skill from local MOP chunks (or --content-file).
 *
 * Usage:
 *   node scripts/mop/mop-to-skill.js --mop-id vdu-bmc-redfish-check --from-dir scripts/mop/out/vdu-bmc-redfish-check
 *   node scripts/mop/mop-to-skill.js --mop-id x --from-dir ... --install  # copy draft → ~/.cursor/skills
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { slugify, readChunkDir } = require('./lib/mop-utils');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const has = (name) => process.argv.includes(`--${name}`);

const fromDir = arg('from-dir');
const mopIdArg = arg('mop-id');
if (!fromDir) {
  console.error('Usage: node scripts/mop/mop-to-skill.js --from-dir <chunk-dir> [--mop-id id] [--install]');
  process.exit(1);
}

const chunks = readChunkDir(path.resolve(fromDir));
if (!chunks.length) throw new Error('No chunks');
const mopId = slugify(mopIdArg || chunks[0].meta.mop_id || path.basename(path.resolve(fromDir)));
const title = chunks[0].meta.title || mopId;
const triggers = chunks[0].meta.task_triggers || [];
const triggerText = [
  ...triggers,
  'MOP',
  'method of procedure',
  title,
  mopId,
]
  .filter(Boolean)
  .join(', ');

const steps = chunks
  .map((c, i) => {
    const heading = c.meta.section_title || `Section ${i + 1}`;
    return `### ${i + 1}. ${heading}\n\n${c.body}`;
  })
  .join('\n\n');

const skillName = slugify(`mop-${mopId}`);
const skillMd = `---
name: ${skillName}
description: >-
  Follow Method of Procedure "${title}" (mop_id=${mopId}). Use when working on:
  ${triggerText}. Always recall Memoria for the latest MOP chunks before executing.
---

# MOP: ${title}

**mop_id:** \`${mopId}\`  
**Source of truth:** Memoria at \`http://10.10.50.2:8765\` (Procedures / \`[MOP] mop_id=${mopId}\`)

## Before you act

1. Call \`memoria_recall\` with query including \`MOP ${mopId}\` and the user task keywords.
2. Prefer hits whose content starts with \`[MOP] mop_id=${mopId}\`.
3. List the required steps to the user and follow them in order.
4. If Memoria returns a newer/conflicting step, **prefer Memoria** over this draft skill.

## Procedure (draft snapshot)

${steps}

## After completion

- Note deviations or outcomes in Memoria (\`memoria_remember\`, semantic, high) if the user shipped a milestone.
- Do not silently install or overwrite other skills.
`;

const repoRoot = path.resolve(__dirname, '../..');
const draftDir = path.join(repoRoot, '.cursor', 'skills-drafts', skillName);
fs.mkdirSync(draftDir, { recursive: true });
const draftFile = path.join(draftDir, 'SKILL.md');
fs.writeFileSync(draftFile, skillMd, 'utf8');
console.log(`Draft skill written: ${draftFile}`);

if (has('install')) {
  const dest = path.join(os.homedir(), '.cursor', 'skills', skillName);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'SKILL.md'), skillMd, 'utf8');
  console.log(`Installed to: ${dest}`);
} else {
  console.log('Review the draft, then re-run with --install or copy to ~/.cursor/skills/');
}
