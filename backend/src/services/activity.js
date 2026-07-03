const db = require('../db');

async function logActivity({
  taskId,
  projectId,
  action,
  taskTitle,
  fromColumn,
  toColumn,
  metadata,
}) {
  await db.query(
    `INSERT INTO task_activity (task_id, project_id, action, task_title, from_column, to_column, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      taskId || null,
      projectId,
      action,
      taskTitle || null,
      fromColumn || null,
      toColumn || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

async function getProjectIdForTask(taskId) {
  const { rows } = await db.query(
    `SELECT b.project_id
     FROM tasks t
     JOIN columns c ON c.id = t.column_id
     JOIN boards b ON b.id = c.board_id
     WHERE t.id = $1`,
    [taskId]
  );
  return rows[0]?.project_id;
}

async function getProjectIdForColumn(columnId) {
  const { rows } = await db.query(
    `SELECT b.project_id
     FROM columns c
     JOIN boards b ON b.id = c.board_id
     WHERE c.id = $1`,
    [columnId]
  );
  return rows[0]?.project_id;
}

async function getColumnName(columnId) {
  const { rows } = await db.query('SELECT name FROM columns WHERE id = $1', [columnId]);
  return rows[0]?.name;
}

module.exports = {
  logActivity,
  getProjectIdForTask,
  getProjectIdForColumn,
  getColumnName,
};
