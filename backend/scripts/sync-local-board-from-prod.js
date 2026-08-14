/**
 * Sync Mission Control projects/boards from production (10.10.50.6) into the
 * local Docker Postgres DB. Idempotent — safe to run on a schedule.
 *
 * Usage:
 *   node backend/scripts/sync-local-board-from-prod.js
 *   node backend/scripts/sync-local-board-from-prod.js --quiet
 *
 * Direction: production → localhost only (prod remains source of truth).
 * Creates missing projects/tasks, moves tasks when the prod column changes,
 * and refreshes description/priority/assignee/due_date/github link fields.
 * Does not delete local-only tasks.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const quiet = process.argv.includes('--quiet');
function log(...args) {
  if (!quiet) console.log(...args);
}

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

process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@127.0.0.1:5432/mission_control';

const db = require('../src/db');

const PROD = (
  process.env.PROD_API_URL ||
  process.env.MISSION_CONTROL_API_URL ||
  'http://10.10.50.6/api'
).replace(/\/$/, '');

async function prodApi(p) {
  const tokens = [process.env.MISSION_CONTROL_API_TOKEN, process.env.AUTH_API_TOKEN].filter(
    Boolean
  );
  let lastErr;
  for (const token of tokens) {
    const res = await fetch(`${PROD}${p}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (res.ok) return data;
    lastErr = new Error(data?.error || `${res.status} ${p}`);
    if (res.status !== 401) throw lastErr;
  }
  throw lastErr || new Error('No production API token configured');
}

async function ensureProject({ name, description, color }) {
  const { rows } = await db.query(`SELECT * FROM projects WHERE LOWER(name) = LOWER($1)`, [name]);
  if (rows[0]) {
    const cur = rows[0];
    if (
      (description || null) !== (cur.description || null) ||
      (color || null) !== (cur.color || null)
    ) {
      await db.query(
        `UPDATE projects SET description = $2, color = $3, updated_at = NOW() WHERE id = $1`,
        [cur.id, description || null, color || cur.color || '#6366f1']
      );
      log(`~ project meta ${name}`);
    } else {
      log(`= project ${name}`);
    }
    return cur;
  }

  const { rows: created } = await db.query(
    `INSERT INTO projects (name, description, color) VALUES ($1, $2, $3) RETURNING *`,
    [name, description || null, color || '#6366f1']
  );
  const project = created[0];
  const { rows: boards } = await db.query(
    `INSERT INTO boards (project_id, name) VALUES ($1, $2) RETURNING *`,
    [project.id, 'Main Board']
  );
  const cols = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];
  for (let i = 0; i < cols.length; i += 1) {
    await db.query(`INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3)`, [
      boards[0].id,
      cols[i],
      i,
    ]);
  }
  log(`+ project ${name}`);
  return project;
}

async function loadLocalBoard(projectId) {
  const { rows: boards } = await db.query(`SELECT * FROM boards WHERE project_id = $1 LIMIT 1`, [
    projectId,
  ]);
  if (!boards[0]) throw new Error(`No board for project ${projectId}`);
  const { rows: columns } = await db.query(
    `SELECT * FROM columns WHERE board_id = $1 ORDER BY position`,
    [boards[0].id]
  );
  const { rows: tasks } = await db.query(
    `SELECT t.* FROM tasks t
     JOIN columns c ON c.id = t.column_id
     WHERE c.board_id = $1`,
    [boards[0].id]
  );
  return { board: boards[0], columns, tasks };
}

function sameText(a, b) {
  return String(a ?? '') === String(b ?? '');
}

async function syncTasks(localProjectId, prodBoard) {
  const local = await loadLocalBoard(localProjectId);
  const colByName = new Map(local.columns.map((c) => [c.name.toLowerCase(), c]));
  const localByTitle = new Map(local.tasks.map((t) => [t.title.toLowerCase(), t]));
  let created = 0;
  let updated = 0;
  let moved = 0;

  for (const col of prodBoard.columns || []) {
    const localCol = colByName.get(String(col.name).toLowerCase());
    if (!localCol) {
      log(`  ! missing column ${col.name}`);
      continue;
    }

    let position = local.tasks.filter((t) => t.column_id === localCol.id).length;

    for (const task of col.tasks || []) {
      const key = String(task.title).toLowerCase();
      const existing = localByTitle.get(key);
      const priority = task.priority || 'medium';
      const description = task.description || null;
      const assignee = task.assignee || null;
      const dueDate = task.due_date || null;
      const githubRepo = task.github_repo || null;
      const githubIssue = task.github_issue_number ?? null;

      if (!existing) {
        await db.query(
          `INSERT INTO tasks
             (id, column_id, title, description, priority, assignee, due_date, position, github_repo, github_issue_number)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            localCol.id,
            task.title,
            description,
            priority,
            assignee,
            dueDate,
            position,
            githubRepo,
            githubIssue,
          ]
        );
        position += 1;
        created += 1;
        localByTitle.set(key, { title: task.title, column_id: localCol.id });
        log(`  + [${col.name}] ${task.title}`);
        continue;
      }

      const needsMove = existing.column_id !== localCol.id;
      const needsUpdate =
        !sameText(existing.description, description) ||
        !sameText(existing.priority, priority) ||
        !sameText(existing.assignee, assignee) ||
        !sameText(existing.due_date, dueDate) ||
        !sameText(existing.github_repo, githubRepo) ||
        String(existing.github_issue_number ?? '') !== String(githubIssue ?? '');

      if (needsMove || needsUpdate) {
        await db.query(
          `UPDATE tasks
             SET column_id = $2,
                 description = $3,
                 priority = $4,
                 assignee = $5,
                 due_date = $6,
                 github_repo = $7,
                 github_issue_number = $8,
                 position = CASE WHEN column_id = $2 THEN position ELSE $9 END,
                 updated_at = NOW()
           WHERE id = $1`,
          [
            existing.id,
            localCol.id,
            description,
            priority,
            assignee,
            dueDate,
            githubRepo,
            githubIssue,
            position,
          ]
        );
        if (needsMove) {
          moved += 1;
          position += 1;
          log(`  → [${col.name}] ${task.title}`);
        } else {
          updated += 1;
          log(`  ~ ${task.title}`);
        }
        existing.column_id = localCol.id;
        existing.description = description;
        existing.priority = priority;
        existing.assignee = assignee;
        existing.due_date = dueDate;
        existing.github_repo = githubRepo;
        existing.github_issue_number = githubIssue;
      }
    }
  }

  log(`  summary: +${created} created, ${moved} moved, ${updated} updated`);
  return { created, moved, updated };
}

async function main() {
  log('Local DB', String(process.env.DATABASE_URL).replace(/:[^:@/]+@/, ':***@'));
  log('Prod API', PROD);

  const prodProjects = await prodApi('/projects');
  log('Prod projects:', prodProjects.map((p) => p.name).join(', '));

  const totals = { created: 0, moved: 0, updated: 0, projects: 0 };

  for (const prod of prodProjects) {
    const local = await ensureProject({
      name: prod.name,
      description: prod.description,
      color: prod.color,
    });
    totals.projects += 1;
    log(`Syncing tasks: ${prod.name}`);
    const board = await prodApi(`/projects/${prod.id}/board`);
    const stats = await syncTasks(local.id, board);
    totals.created += stats.created;
    totals.moved += stats.moved;
    totals.updated += stats.updated;
  }

  if (quiet) {
    console.log(
      JSON.stringify({
        ok: true,
        projects: totals.projects,
        created: totals.created,
        moved: totals.moved,
        updated: totals.updated,
        at: new Date().toISOString(),
      })
    );
  } else {
    const { rows } = await db.query(
      `SELECT p.name,
              (SELECT COUNT(*)::int FROM tasks t
                 JOIN columns c ON c.id = t.column_id
                 JOIN boards b ON b.id = c.board_id
                WHERE b.project_id = p.id) AS tasks
       FROM projects p
       ORDER BY p.created_at`
    );
    console.log('\nLocal projects after sync:');
    for (const r of rows) console.log(`- ${r.name}: ${r.tasks} tasks`);
    console.log(
      `\nTotals: +${totals.created} created, ${totals.moved} moved, ${totals.updated} updated`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch {
      /* ignore */
    }
  });
