/**
 * Add or move a task on production Mission Control.
 * Usage:
 *   node scripts/add-prod-task.js --project "Mission Control" --column Done --title "..." --priority medium --description "..."
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const BASE = (process.env.MISSION_CONTROL_API_URL || 'http://10.10.50.6/api').replace(
  /\/$/,
  ''
);
const token = process.env.MISSION_CONTROL_API_TOKEN || process.env.AUTH_API_TOKEN || '';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function api(p, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE}${p}`, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${p}`);
  return data;
}

(async () => {
  const projectName = arg('project', 'Mission Control');
  const columnName = arg('column', 'Done');
  const title = arg('title');
  const description = arg('description', '');
  const priority = arg('priority', 'medium');
  if (!title) throw new Error('--title required');

  const projects = await api('/projects');
  const project = projects.find(
    (p) => p.name.toLowerCase() === projectName.toLowerCase()
  );
  if (!project) throw new Error(`Project not found: ${projectName}`);

  const board = await api(`/projects/${project.id}/board`);
  const col = board.columns.find(
    (c) => c.name.toLowerCase() === columnName.toLowerCase()
  );
  if (!col) throw new Error(`Column not found: ${columnName}`);

  const existing = board.columns
    .flatMap((c) => (c.tasks || []).map((t) => ({ ...t, column: c.name })))
    .find((t) => t.title.toLowerCase() === title.toLowerCase());

  if (existing) {
    if (existing.column.toLowerCase() !== columnName.toLowerCase()) {
      await api(`/tasks/${existing.id}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ column_id: col.id, position: 0 }),
      });
      console.log(`Moved to ${columnName}: ${title}`);
    } else {
      console.log(`Already in ${columnName}: ${title}`);
    }
    return;
  }

  const created = await api(`/columns/${col.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title, description, priority }),
  });
  console.log(`Created in ${project.name} / ${columnName}: ${created.title}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
