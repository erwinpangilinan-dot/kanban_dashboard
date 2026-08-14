#!/usr/bin/env node
/**
 * Ingest chunked MOP markdown into Memoria via POST /remember.
 *
 * Usage:
 *   node scripts/mop/ingest-mop.js <chunk-dir>
 *   MEMORIA_API_URL=http://10.10.50.2:8765 node scripts/mop/ingest-mop.js scripts/mop/out/vdu-bmc-redfish-check
 */
const path = require('path');
const {
  formatMemoryContent,
  readChunkDir,
} = require('./lib/mop-utils');

const BASE = (process.env.MEMORIA_API_URL || 'http://10.10.50.2:8765').replace(/\/$/, '');
const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/mop/ingest-mop.js <chunk-dir>');
  process.exit(1);
}

async function remember(content) {
  const res = await fetch(`${BASE}/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      memory_type: 'semantic',
      importance: 'high',
      force: true,
      // Title Case headings and step text in a MOP are not entities. They come
      // from the document's `entities:` frontmatter instead.
      infer_entities: false,
    }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`remember ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

(async () => {
  const chunks = readChunkDir(path.resolve(dir));
  if (!chunks.length) throw new Error('No .md chunks found');
  const mopId = chunks[0].meta.mop_id || path.basename(path.resolve(dir));
  const title = chunks[0].meta.title || mopId;
  const total = chunks.length;
  console.log(`Ingesting ${total} chunks for mop_id=${mopId} → ${BASE}`);

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const content = formatMemoryContent({
      mopId,
      title,
      section: c.meta.section || i + 1,
      sectionTotal: total,
      sectionTitle: c.meta.section_title || c.file,
      triggers: c.meta.task_triggers || [],
      entities: c.meta.entities || [],
      body: c.body,
    });
    const data = await remember(content);
    results.push({ file: c.file, ok: true, id: data.id || data.memory_id || null });
    console.log(`  + ${c.file}`);
  }

  // Quick recall check
  const q = encodeURIComponent(`MOP ${mopId}`);
  const recallRes = await fetch(`${BASE}/recall?q=${q}&limit=5`);
  const recall = await recallRes.json().catch(() => ({}));
  const hits = Array.isArray(recall) ? recall : recall.results || recall.memories || [];
  console.log(`Done. Recall probe for "MOP ${mopId}": ${hits.length} hit(s)`);
  console.log(JSON.stringify({ ingested: results.length, mop_id: mopId }, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
