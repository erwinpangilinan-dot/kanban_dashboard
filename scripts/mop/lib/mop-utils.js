const fs = require('fs');
const path = require('path');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'mop';
}

function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(text).trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      if (!inner) {
        meta[key] = [];
      } else {
        try {
          meta[key] = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          meta[key] = inner
            .split(',')
            .map((x) => x.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
        }
      }
    } else if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      meta[key] = val.slice(1, -1);
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: m[2].trim() };
}

function formatMemoryContent({ mopId, title, section, sectionTotal, sectionTitle, triggers, entities, body }) {
  const entityLine = (entities || [])
    .map((e) => (String(e).startsWith('[[') ? e : `[[${e}]]`))
    .join(', ');
  const triggerLine = Array.isArray(triggers) ? triggers.join(', ') : String(triggers || '');
  return [
    `[MOP] mop_id=${mopId} | title=${title} | section=${section}/${sectionTotal} | ${sectionTitle}`,
    triggerLine ? `Triggers: ${triggerLine}` : null,
    entityLine ? `Entities: ${entityLine}` : null,
    '',
    body,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

function writeChunkFiles(outDir, mopId, chunks, baseMeta = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  chunks.forEach((chunk, idx) => {
    const n = idx + 1;
    const sectionSlug = slugify(chunk.sectionTitle);
    const file = path.join(outDir, `${String(n).padStart(2, '0')}-${sectionSlug}.md`);
    const triggers = baseMeta.task_triggers || baseMeta.triggers || [];
    const entities = baseMeta.entities || [];
    const fm = [
      '---',
      'type: mop',
      `mop_id: ${mopId}`,
      `title: ${JSON.stringify(baseMeta.title || mopId)}`,
      `task_triggers: ${JSON.stringify(triggers)}`,
      `entities: ${JSON.stringify(entities)}`,
      'importance: high',
      `section: ${n}`,
      `section_title: ${JSON.stringify(chunk.sectionTitle)}`,
      '---',
      '',
      chunk.body,
      '',
    ].join('\n');
    fs.writeFileSync(file, fm, 'utf8');
    written.push(file);
  });
  return written;
}

function splitByHeadings(markdown, defaultTitle = 'Procedure') {
  const text = String(markdown).replace(/\r\n/g, '\n').trim();
  const { meta, body } = parseFrontmatter(text);
  const lines = body.split('\n');
  const chunks = [];
  let current = { sectionTitle: defaultTitle, lines: [] };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (current.lines.some((l) => l.trim())) {
        chunks.push({
          sectionTitle: current.sectionTitle,
          body: current.lines.join('\n').trim(),
        });
      }
      current = { sectionTitle: h2[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((l) => l.trim())) {
    chunks.push({
      sectionTitle: current.sectionTitle,
      body: current.lines.join('\n').trim(),
    });
  }
  if (!chunks.length) {
    chunks.push({ sectionTitle: defaultTitle, body });
  }
  return { meta, chunks };
}

function readChunkDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Directory not found: ${dir}`);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    return { file: f, meta, body };
  });
}

module.exports = {
  slugify,
  parseFrontmatter,
  formatMemoryContent,
  writeChunkFiles,
  splitByHeadings,
  readChunkDir,
};
