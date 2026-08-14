/**
 * Sync Kanban projects (and Network Equipment board tasks) from production
 * Mission Control into the local API DB.
 *
 * Usage (from repo root, against local Docker API):
 *   node backend/scripts/sync-projects-from-prod.js
 *
 * Env:
 *   PROD_API_URL     default http://10.10.50.6/api
 *   LOCAL_API_URL    default http://127.0.0.1/api
 *   AUTH_API_TOKEN / MISSION_CONTROL_API_TOKEN — used for both (override LOCAL_AUTH_API_TOKEN if needed)
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

const PROD = (process.env.PROD_API_URL || 'http://10.10.50.6/api').replace(/\/$/, '');
const LOCAL = (process.env.LOCAL_API_URL || 'http://127.0.0.1/api').replace(/\/$/, '');

function tokenFor(which) {
  if (which === 'local') {
    return (
      process.env.LOCAL_AUTH_API_TOKEN ||
      process.env.AUTH_API_TOKEN ||
      process.env.MISSION_CONTROL_API_TOKEN
    );
  }
  return process.env.MISSION_CONTROL_API_TOKEN || process.env.AUTH_API_TOKEN;
}

async function api(base, token, p, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${base}${p}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureProject(localToken, prodProject, localProjects) {
  let local = localProjects.find(
    (p) => String(p.name).toLowerCase() === String(prodProject.name).toLowerCase()
  );
  if (local) {
    console.log(`= project exists: ${local.name} (${local.id})`);
    return local;
  }
  local = await api(LOCAL, localToken, '/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: prodProject.name,
      description: prodProject.description || null,
      color: prodProject.color || '#6366f1',
    }),
  });
  console.log(`+ created project: ${local.name} (${local.id})`);
  localProjects.push(local);
  return local;
}

async function syncBoardTasks(prodToken, localToken, prodProjectId, localProjectId) {
  const prodBoard = await api(PROD, prodToken, `/projects/${prodProjectId}/board`);
  const localBoard = await api(LOCAL, localToken, `/projects/${localProjectId}/board`);

  const localColByName = new Map(
    (localBoard.columns || []).map((c) => [String(c.name).toLowerCase(), c])
  );
  const existing = new Set();
  for (const col of localBoard.columns || []) {
    for (const t of col.tasks || []) existing.add(String(t.title).toLowerCase());
  }

  let created = 0;
  let skipped = 0;
  for (const col of prodBoard.columns || []) {
    const localCol = localColByName.get(String(col.name).toLowerCase());
    if (!localCol) {
      console.log(`  ! missing local column: ${col.name}`);
      continue;
    }
    for (const task of col.tasks || []) {
      const key = String(task.title).toLowerCase();
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      await api(LOCAL, localToken, `/columns/${localCol.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: task.title,
          description: task.description || null,
          priority: task.priority || 'medium',
          assignee: task.assignee || null,
          due_date: task.due_date || null,
        }),
      });
      existing.add(key);
      created += 1;
      console.log(`  + [${col.name}] ${task.title}`);
    }
  }
  console.log(`  tasks: +${created} created, ${skipped} already present`);
}

async function main() {
  const prodToken = tokenFor('prod');
  let localToken = tokenFor('local');
  if (!prodToken) throw new Error('AUTH_API_TOKEN / MISSION_CONTROL_API_TOKEN required for production');

  console.log('PROD', PROD);
  console.log('LOCAL', LOCAL);

  const prodProjects = await api(PROD, prodToken, '/projects');
  console.log(
    'Prod projects:',
    prodProjects.map((p) => p.name).join(', ')
  );

  let localProjects;
  try {
    localProjects = await api(LOCAL, localToken, '/projects');
  } catch (err) {
    if (err.status === 401 && process.env.LOCAL_AUTH_API_TOKEN_FROM_CONTAINER !== '1') {
      throw new Error(
        `Local API rejected token (${err.message}). Set LOCAL_AUTH_API_TOKEN to the token inside the api container, or run via: docker compose exec api node ...`
      );
    }
    throw err;
  }

  console.log(
    'Local projects (before):',
    localProjects.map((p) => p.name).join(', ') || '(none)'
  );

  for (const prod of prodProjects) {
    const local = await ensureProject(localToken, prod, localProjects);
    if (/network equipment/i.test(prod.name)) {
      console.log(`Syncing board tasks for ${prod.name}...`);
      await syncBoardTasks(prodToken, localToken, prod.id, local.id);
    }
  }

  const after = await api(LOCAL, localToken, '/projects');
  console.log('\nLocal projects (after):');
  for (const p of after) {
    console.log(`- ${p.name} (${p.id}) boards=${p.board_count ?? '?'}`);
  }
  console.log('\nOpen http://localhost and select Network Equipment');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
