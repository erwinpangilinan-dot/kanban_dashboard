/**
 * Create/update a "Network Equipment" project on Mission Control
 * with Done tasks for shipped work and Backlog for next features.
 *
 * Production (source of truth):
 *   node backend/scripts/seed-network-board.js
 *   (uses MISSION_CONTROL_API_URL + AUTH_API_TOKEN from repo .env)
 *
 * Local Docker override:
 *   MISSION_CONTROL_API_URL=http://localhost/api node backend/scripts/seed-network-board.js
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

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = process.env.MISSION_CONTROL_API_TOKEN || process.env.AUTH_API_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${path}`);
  return data;
}

const DONE_TASKS = [
  {
    title: 'DB: network_devices + snapshots migration (V8)',
    description:
      'Postgres tables for inventory and latest BMC probe; workspace_settings keys for per-vendor Redfish credentials (redfish_dell_*).',
    priority: 'high',
  },
  {
    title: 'Redfish Dell client + TCP:443 latency probe',
    description:
      'backend/src/services/network-probe.js — TCP connect RTT to BMC:443; Dell iDRAC Redfish (system/processor/memory/storage); TLS rejectUnauthorized=false for BMC.',
    priority: 'high',
  },
  {
    title: 'Per-vendor Redfish credentials (shared DELL)',
    description:
      'network-credentials.js + Network Settings UI/API — shared username/password per vendor stored in workspace_settings.',
    priority: 'high',
  },
  {
    title: 'Google Sheet inventory sync (vDU_List)',
    description:
      'network-sync.js — Sheets API sync of Cluster, BMC IP, Vendor, Model Type, Model, Application; tolerates optional OAM IP. Sheet ID configurable via NETWORK_VDU_SHEET_ID.',
    priority: 'high',
  },
  {
    title: 'Background poller writing device snapshots',
    description:
      'network-poller.js — periodic sheet sync + BMC probe; started from server.js. Windows: host poller (network-host-poller.js) because Docker Desktop lacks IPv6 LAN route.',
    priority: 'high',
  },
  {
    title: 'REST API /api/network (devices, sync, settings)',
    description:
      'GET /devices, GET /devices/:id, POST /sync, GET/POST /settings — inventory + latest snapshot for UI.',
    priority: 'high',
  },
  {
    title: 'Network sidebar tab + NetworkPage UI',
    description:
      'Live status table (reachability, latency, Sys/CPU/Mem/Sto badges), Sync from Drive, DELL credentials panel, ~12s auto-refresh from DB snapshots.',
    priority: 'high',
  },
  {
    title: 'Docker/Windows verify against 3 BMC IPv6s',
    description:
      'Verified sheet sync (3 XR8720t), host TCP ~45ms, Redfish OK with credentials; system Critical flagged on cluster …3032.',
    priority: 'medium',
  },
];

const BACKLOG_TASKS = [
  {
    title: 'OAM IP host monitoring (ping/SSH/app health)',
    description:
      'Once OAM IP column is on the sheet — sync already stores oam_ip. Add host-side reachability and optional app health (out of scope for phase 1).',
    priority: 'high',
  },
  {
    title: 'Alerting on Redfish Critical (Telegram/email)',
    description:
      'Notify when system/storage health is Critical or BMC goes down; reuse existing Telegram/email notify paths.',
    priority: 'medium',
  },
  {
    title: 'Per-device Redfish credentials (beyond vendor-shared)',
    description:
      'Allow override credentials per cluster/BMC when not all DELL nodes share the same iDRAC account.',
    priority: 'low',
  },
  {
    title: 'Investigate Critical health on cluster 29973503032',
    description:
      'Redfish reports system Health=Critical while CPU/Mem/Storage OK. Drill into iDRAC sensors/logs and surface detail in UI.',
    priority: 'high',
  },
  {
    title: 'Staggered per-device poll scheduling',
    description:
      'Phase 1 probes all devices each tick; optionally stagger 30–60s per device to reduce iDRAC load as inventory grows.',
    priority: 'low',
  },
  {
    title: 'Container IPv6 route for BMC probing (no host poller)',
    description:
      'Make API container reach BMC IPv6 directly (Linux deploy / WSL mirrored networking) so NETWORK_SKIP_CONTAINER_POLLER is unnecessary.',
    priority: 'medium',
  },
];

async function ensureProject() {
  const projects = await api('/projects');
  let project = projects.find((p) => /network/i.test(p.name));
  if (!project) {
    project = await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Network Equipment',
        description:
          'vDU / BMC monitoring: Drive inventory sync, TCP reachability, Dell Redfish health. Track shipped work and next features.',
        color: '#0ea5e9',
      }),
    });
    console.log('Created project:', project.id, project.name);
  } else {
    console.log('Using existing project:', project.id, project.name);
  }
  return project;
}

async function findColumn(board, name) {
  const col = board.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!col) throw new Error(`Column ${name} not found`);
  return col;
}

async function createTaskIfMissing(columnId, task, existingTitles) {
  const key = task.title.toLowerCase();
  if (existingTitles.has(key)) {
    console.log('  skip (exists):', task.title);
    return null;
  }
  const created = await api(`/columns/${columnId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: task.title,
      description: task.description,
      priority: task.priority || 'medium',
    }),
  });
  existingTitles.add(key);
  console.log('  +', created.title);
  return created;
}

async function moveToDone(taskId, doneColumnId) {
  await api(`/tasks/${taskId}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ column_id: doneColumnId, position: 0 }),
  });
}

async function main() {
  console.log('API', BASE);
  const project = await ensureProject();
  const board = await api(`/projects/${project.id}/board`);
  const doneCol = await findColumn(board, 'Done');
  const backlogCol = await findColumn(board, 'Backlog');

  const existingTitles = new Set();
  for (const col of board.columns) {
    for (const t of col.tasks || []) existingTitles.add(t.title.toLowerCase());
  }

  console.log('\nDone (implemented):');
  for (const task of DONE_TASKS) {
    const created = await createTaskIfMissing(doneCol.id, task, existingTitles);
    // If API creates in Done column already, no move needed.
    // Some boards create into first column — move if we created into Done by id.
    if (created && created.column_id !== doneCol.id) {
      await moveToDone(created.id, doneCol.id);
    }
  }

  // Recreate into Done explicitly if create always targets Backlog
  const board2 = await api(`/projects/${project.id}/board`);
  const doneIds = new Set((board2.columns.find((c) => c.id === doneCol.id)?.tasks || []).map((t) => t.id));
  for (const col of board2.columns) {
    if (col.id === doneCol.id) continue;
    for (const t of col.tasks || []) {
      if (DONE_TASKS.some((d) => d.title.toLowerCase() === t.title.toLowerCase()) && !doneIds.has(t.id)) {
        await moveToDone(t.id, doneCol.id);
        console.log('  moved to Done:', t.title);
      }
    }
  }

  console.log('\nBacklog (next features):');
  const titlesAfter = new Set();
  const board3 = await api(`/projects/${project.id}/board`);
  for (const col of board3.columns) {
    for (const t of col.tasks || []) titlesAfter.add(t.title.toLowerCase());
  }
  for (const task of BACKLOG_TASKS) {
    await createTaskIfMissing(backlogCol.id, task, titlesAfter);
  }

  const final = await api(`/projects/${project.id}/board`);
  console.log('\n=== Network Equipment board ===');
  for (const col of final.columns) {
    console.log(`\n[${col.name}] (${(col.tasks || []).length})`);
    for (const t of col.tasks || []) {
      console.log(`  - [${t.priority}] ${t.title}`);
    }
  }
  const uiBase = BASE.replace(/\/api$/, '');
  console.log(`\nOpen: ${uiBase} (select Network Equipment)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
