const db = require('../db');
const { isCompletedColumn } = require('../lib/columns');
const { logActivity } = require('./activity');
const { sendMessage } = require('./telegram');

const COMPLETED_COLS = "('Review', 'Done')";

function isEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function notifyOn() {
  const raw = process.env.TELEGRAM_NOTIFY_ON || 'completed,overdue,urgent';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function wants(event) {
  return isEnabled() && notifyOn().has(event);
}

function formatTaskLine(task, projectName) {
  const parts = [`<b>${escapeHtml(task.title)}</b>`, `(${escapeHtml(projectName)})`];
  if (task.assignee) parts.push(`— ${escapeHtml(task.assignee)}`);
  if (task.due_date) {
    const due = new Date(task.due_date).toISOString().slice(0, 10);
    parts.push(`due ${due}`);
  }
  return parts.join(' ');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getTaskContext(taskId) {
  const { rows } = await db.query(
    `SELECT t.*, p.id AS project_id, p.name AS project_name, c.name AS column_name
     FROM tasks t
     JOIN columns c ON c.id = t.column_id
     JOIN boards b ON b.id = c.board_id
     JOIN projects p ON p.id = b.project_id
     WHERE t.id = $1`,
    [taskId]
  );
  return rows[0];
}

async function notifyCompleted(taskId, toColumn) {
  if (!wants('completed') || !isCompletedColumn(toColumn)) return;

  const task = await getTaskContext(taskId);
  if (!task) return;

  const text = `✅ <b>Task completed</b>\n${formatTaskLine(task, task.project_name)}\nColumn: ${escapeHtml(toColumn)}`;
  await sendMessage(text);
}

async function notifyUrgent(taskId) {
  if (!wants('urgent')) return;

  const task = await getTaskContext(taskId);
  if (!task || task.priority !== 'urgent') return;

  const text = `🔴 <b>Urgent task</b>\n${formatTaskLine(task, task.project_name)}\nColumn: ${escapeHtml(task.column_name)}`;
  await sendMessage(text);
}

async function notifyOverdue(task) {
  if (!wants('overdue')) return;

  const text = `⏰ <b>Overdue task</b>\n${formatTaskLine(task, task.project_name)}\nColumn: ${escapeHtml(task.column_name)}`;
  await sendMessage(text);

  await logActivity({
    taskId: task.id,
    projectId: task.project_id,
    action: 'overdue_notified',
    taskTitle: task.title,
    metadata: { due_date: task.due_date },
  });
}

async function checkOverdueTasks() {
  if (!wants('overdue')) return;

  const { rows } = await db.query(`
    SELECT t.*, p.id AS project_id, p.name AS project_name, c.name AS column_name
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    JOIN boards b ON b.id = c.board_id
    JOIN projects p ON p.id = b.project_id
    WHERE t.due_date < CURRENT_DATE
      AND c.name NOT IN ${COMPLETED_COLS}
      AND NOT EXISTS (
        SELECT 1 FROM task_activity a
        WHERE a.task_id = t.id AND a.action = 'overdue_notified'
      )
  `);

  for (const task of rows) {
    await notifyOverdue(task);
  }
}

function fireAndForget(fn) {
  fn().catch((err) => console.error('Background task failed:', err.message));
}

function startOverdueChecker() {
  if (!wants('overdue')) return;

  const hours = Number(process.env.TELEGRAM_OVERDUE_CHECK_HOURS) || 24;
  const run = () => checkOverdueTasks().catch((err) => {
    console.error('Overdue check failed:', err.message);
  });

  run();
  setInterval(run, hours * 60 * 60 * 1000);
  console.log(`Telegram overdue checker every ${hours}h`);
}

module.exports = {
  isEnabled,
  notifyOn,
  wants,
  formatTaskLine,
  escapeHtml,
  notifyCompleted,
  notifyUrgent,
  notifyOverdue,
  checkOverdueTasks,
  fireAndForget,
  startOverdueChecker,
};
