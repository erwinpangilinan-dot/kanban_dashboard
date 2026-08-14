#!/usr/bin/env node
/**
 * Split a markdown MOP into Procedures/<mop_id>/*.md chunk files.
 *
 * Usage:
 *   node scripts/mop/chunk-mop.js <source.md> [--out scripts/mop/out] [--mop-id id]
 */
const fs = require('fs');
const path = require('path');
const {
  slugify,
  splitByHeadings,
  writeChunkFiles,
} = require('./lib/mop-utils');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const src = process.argv[2];
if (!src || src.startsWith('--')) {
  console.error('Usage: node scripts/mop/chunk-mop.js <source.md> [--out dir] [--mop-id id]');
  process.exit(1);
}

const abs = path.resolve(src);
const raw = fs.readFileSync(abs, 'utf8');
const { meta, chunks } = splitByHeadings(raw, 'Overview');
const mopId = slugify(arg('mop-id', meta.mop_id || path.basename(abs, path.extname(abs))));
const title = meta.title || mopId;
const outRoot = path.resolve(arg('out', path.join(__dirname, 'out')));
const outDir = path.join(outRoot, mopId);

const baseMeta = {
  ...meta,
  mop_id: mopId,
  title,
  task_triggers: meta.task_triggers || meta.triggers || [],
  entities: meta.entities || [],
};

const written = writeChunkFiles(outDir, mopId, chunks, baseMeta);
console.log(`Wrote ${written.length} chunks → ${outDir}`);
for (const f of written) console.log(' ', path.basename(f));
