const crypto = require('crypto');
const db = require('../db');
const { isCompletedColumn } = require('../lib/columns');
const { logActivity, getProjectIdForTask, getColumnName } = require('./activity');

const ISSUE_URL_RE = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)\/?$/i;

function isEnabled() {
  return Boolean(process.env.GITHUB_TOKEN);
}

function defaultRepo() {
  const repo = process.env.GITHUB_DEFAULT_REPO?.trim();
  return repo || null;
}

function autoCreateEnabled() {
  if (!isEnabled() || !defaultRepo()) return false;
  return process.env.GITHUB_AUTO_CREATE !== 'false';
}

function publicUrl() {
  return (process.env.MISSION_CONTROL_PUBLIC_URL || '').replace(/\/$/, '');
}

function parseIssueUrl(url) {
  if (!url?.trim()) return null;
  const m = url.trim().match(ISSUE_URL_RE);
  if (!m) return null;
  return { repo: m[1], number: Number(m[2]) };
}

function issueUrl(repo, number) {
  if (!repo || !number) return null;
  return `https://github.com/${repo}/issues/${number}`;
}

function enrichTask(task) {
  if (!task) return task;
  return {
    ...task,
    github_issue_url: issueUrl(task.github_repo, task.github_issue_number),
  };
}

function priorityLabel(priority) {
  return ({ low: 'low', medium: 'medium', high: 'high', urgent: 'urgent' })[priority] || 'medium';
}

function buildIssueBody(task, projectName) {
  const lines = [];
  if (task.description) lines.push(task.description, '');
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Priority:** ${priorityLabel(task.priority)}`);
  if (task.assignee) lines.push(`**Assignee:** ${task.assignee}`);
  if (task.due_date) {
    lines.push(`**Due:** ${new Date(task.due_date).toISOString().slice(0, 10)}`);
  }
  const base = publicUrl();
  if (base) lines.push('', `[Open in Mission Control](${base})`);
  return lines.join('\n');
}

function issueStateForColumnChange(fromColumn, toColumn) {
  const wasCompleted = isCompletedColumn(fromColumn);
  const nowCompleted = isCompletedColumn(toColumn);
  if (!wasCompleted && nowCompleted) return 'closed';
  if (wasCompleted && !nowCompleted) return 'open';
  return null;
}

async function setIssueState(repo, issueNumber, state) {
  return githubApi(`/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: { state },
  });
}

async function syncIssueForColumnChange(task, fromColumn, toColumn) {
  if (!isEnabled() || !task?.github_repo || !task?.github_issue_number) return;

  const state = issueStateForColumnChange(fromColumn, toColumn);
  if (!state) return;

  await setIssueState(task.github_repo, task.github_issue_number, state);

  const projectId = await getProjectIdForTask(task.id);
  if (projectId) {
    await logActivity({
      taskId: task.id,
      projectId,
      action: state === 'closed' ? 'github_issue_closed' : 'github_issue_reopened',
      taskTitle: task.title,
      fromColumn,
      toColumn,
      metadata: {
        github_repo: task.github_repo,
        github_issue_number: task.github_issue_number,
      },
    });
  }
}

async function ping() {
  return githubApi('/rate_limit');
}

async function githubApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || res.statusText || 'GitHub API error';
    throw new Error(msg);
  }
  return data;
}

async function getTaskContext(taskId) {
  const { rows } = await db.query(
    `SELECT t.*, p.name AS project_name
     FROM tasks t
     JOIN columns c ON c.id = t.column_id
     JOIN boards b ON b.id = c.board_id
     JOIN projects p ON p.id = b.project_id
     WHERE t.id = $1`,
    [taskId]
  );
  return rows[0];
}

async function createIssueForTask(taskId, repoOverride) {
  const repo = repoOverride || defaultRepo();
  if (!repo) throw new Error('No GitHub repo configured.');

  const task = await getTaskContext(taskId);
  if (!task) throw new Error('Task not found.');
  if (task.github_issue_number) {
    return enrichTask(task);
  }

  const issue = await githubApi(`/repos/${repo}/issues`, {
    method: 'POST',
    body: {
      title: task.title,
      body: buildIssueBody(task, task.project_name),
    },
  });

  const { rows } = await db.query(
    `UPDATE tasks
     SET github_repo = $1, github_issue_number = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [repo, issue.number, taskId]
  );

  const updated = rows[0];
  const projectId = await getProjectIdForTask(taskId);
  if (projectId) {
    await logActivity({
      taskId,
      projectId,
      action: 'github_linked',
      taskTitle: updated.title,
      metadata: { github_repo: repo, github_issue_number: issue.number },
    });
  }

  return enrichTask(updated);
}

async function linkIssueToTask(taskId, issueUrlInput) {
  const parsed = parseIssueUrl(issueUrlInput);
  if (!parsed) throw new Error('Invalid GitHub issue URL.');

  const { rows } = await db.query(
    `UPDATE tasks
     SET github_repo = $1, github_issue_number = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [parsed.repo, parsed.number, taskId]
  );
  if (!rows.length) throw new Error('Task not found.');

  const projectId = await getProjectIdForTask(taskId);
  if (projectId) {
    await logActivity({
      taskId,
      projectId,
      action: 'github_linked',
      taskTitle: rows[0].title,
      metadata: parsed,
    });
  }

  return enrichTask(rows[0]);
}

async function unlinkIssue(taskId) {
  const { rows } = await db.query(
    `UPDATE tasks
     SET github_repo = NULL, github_issue_number = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [taskId]
  );
  if (!rows.length) throw new Error('Task not found.');
  return enrichTask(rows[0]);
}

async function findColumnId(projectId, columnName) {
  const { rows } = await db.query(
    `SELECT c.id
     FROM columns c
     JOIN boards b ON b.id = c.board_id
     WHERE b.project_id = $1 AND c.name = $2
     LIMIT 1`,
    [projectId, columnName]
  );
  return rows[0]?.id;
}

async function moveTaskToColumn(taskId, columnName) {
  const projectId = await getProjectIdForTask(taskId);
  if (!projectId) return null;

  const targetColumnId = await findColumnId(projectId, columnName);
  if (!targetColumnId) return null;

  const { rows: taskRows } = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!taskRows.length) return null;

  const task = taskRows[0];
  if (task.column_id === targetColumnId) return enrichTask(task);

  const fromName = await getColumnName(task.column_id);

  const { rows: maxPos } = await db.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM tasks WHERE column_id = $1',
    [targetColumnId]
  );

  await db.query(
    `UPDATE tasks SET position = position - 1 WHERE column_id = $1 AND position > $2`,
    [task.column_id, task.position]
  );

  const { rows } = await db.query(
    `UPDATE tasks
     SET column_id = $1, position = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [targetColumnId, maxPos[0].next_pos, taskId]
  );

  const action = columnName === 'Done' ? 'completed' : 'moved';
  await logActivity({
    taskId,
    projectId,
    action,
    taskTitle: rows[0].title,
    fromColumn: fromName,
    toColumn: columnName,
    metadata: { source: 'github_webhook' },
  });

  return enrichTask(rows[0]);
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

async function handleWebhookEvent(event, payload) {
  if (event !== 'issues') return { handled: false };

  const { action, issue, repository } = payload;
  if (!issue?.number || !repository?.full_name) return { handled: false };
  if (!['closed', 'reopened'].includes(action)) return { handled: false };

  const { rows } = await db.query(
    `SELECT id FROM tasks
     WHERE github_repo = $1 AND github_issue_number = $2`,
    [repository.full_name, issue.number]
  );
  if (!rows.length) return { handled: false, reason: 'no_linked_task' };

  const taskId = rows[0].id;
  const { rows: taskRows } = await db.query('SELECT column_id FROM tasks WHERE id = $1', [taskId]);
  const currentColumn = taskRows.length ? await getColumnName(taskRows[0].column_id) : null;

  if (action === 'closed' && currentColumn && isCompletedColumn(currentColumn)) {
    return { handled: true, skipped: true, reason: 'already_completed' };
  }
  if (action === 'reopened' && currentColumn && !isCompletedColumn(currentColumn)) {
    return { handled: true, skipped: true, reason: 'already_active' };
  }

  const targetColumn = action === 'closed' ? 'Done' : 'To Do';
  const updated = await moveTaskToColumn(taskId, targetColumn);
  return { handled: true, task_id: taskId, column: targetColumn, task: updated };
}

module.exports = {
  isEnabled,
  defaultRepo,
  autoCreateEnabled,
  parseIssueUrl,
  issueUrl,
  enrichTask,
  buildIssueBody,
  issueStateForColumnChange,
  syncIssueForColumnChange,
  createIssueForTask,
  linkIssueToTask,
  unlinkIssue,
  verifyWebhookSignature,
  handleWebhookEvent,
  ping,
};
