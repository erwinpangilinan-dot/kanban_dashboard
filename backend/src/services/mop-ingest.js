const { remember, recall } = require('./memoria-client');

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
      if (!inner) meta[key] = [];
      else {
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

function splitByHeadings(markdown, defaultTitle = 'Overview') {
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
  if (!chunks.length) chunks.push({ sectionTitle: defaultTitle, body });
  return { meta, chunks };
}

function formatMemoryContent({
  mopId,
  title,
  section,
  sectionTotal,
  sectionTitle,
  triggers,
  entities,
  body,
}) {
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

function buildSkillMarkdown({ mopId, title, triggers, chunks }) {
  const triggerText = [...(triggers || []), 'MOP', title, mopId].filter(Boolean).join(', ');
  const steps = chunks
    .map((c, i) => `### ${i + 1}. ${c.sectionTitle}\n\n${c.body}`)
    .join('\n\n');
  const skillName = slugify(`mop-${mopId}`);
  return {
    skillName,
    markdown: `---
name: ${skillName}
description: >-
  Follow Method of Procedure "${title}" (mop_id=${mopId}). Use when working on:
  ${triggerText}. Always recall Memoria for the latest MOP chunks before executing.
---

# MOP: ${title}

**mop_id:** \`${mopId}\`  
**Source of truth:** Memoria at \`http://10.10.50.2:8765\` (\`[MOP] mop_id=${mopId}\`)

## Before you act

1. Call \`memoria_recall\` with query including \`MOP ${mopId}\` and the user task keywords.
2. Prefer hits whose content starts with \`[MOP] mop_id=${mopId}\`.
3. List the required steps to the user and follow them in order.
4. If Memoria returns a newer/conflicting step, **prefer Memoria** over this draft skill.

## Procedure (draft snapshot)

${steps}
`,
  };
}

async function ingestProcedure({
  markdown,
  mop_id,
  title,
  task_triggers = [],
  entities = [],
}) {
  const { meta, chunks } = splitByHeadings(markdown, 'Overview');
  const mopId = slugify(mop_id || meta.mop_id || title || 'procedure');
  const mopTitle = title || meta.title || mopId;
  const triggers = task_triggers.length
    ? task_triggers
    : meta.task_triggers || meta.triggers || [];
  const ents = entities.length ? entities : meta.entities || [];
  const total = chunks.length;

  const ingested = [];
  for (let i = 0; i < chunks.length; i++) {
    const content = formatMemoryContent({
      mopId,
      title: mopTitle,
      section: i + 1,
      sectionTotal: total,
      sectionTitle: chunks[i].sectionTitle,
      triggers,
      entities: ents,
      body: chunks[i].body,
    });
    // Title Case headings and step text in a MOP are not entities. Name them in
    // the document's `entities:` frontmatter instead of letting Memoria guess.
    const { data } = await remember(content, { infer_entities: false });
    ingested.push({
      section: i + 1,
      section_title: chunks[i].sectionTitle,
      id: data?.id || null,
    });
  }

  const { data: recallData } = await recall(`MOP ${mopId}`, 8);
  const hits = Array.isArray(recallData)
    ? recallData
    : recallData?.results || recallData?.memories || [];

  const skill = buildSkillMarkdown({
    mopId,
    title: mopTitle,
    triggers,
    chunks,
  });

  return {
    mop_id: mopId,
    title: mopTitle,
    chunk_count: total,
    ingested,
    recall_hits: hits.length,
    skill_draft: skill,
  };
}

module.exports = {
  slugify,
  splitByHeadings,
  ingestProcedure,
  buildSkillMarkdown,
};
