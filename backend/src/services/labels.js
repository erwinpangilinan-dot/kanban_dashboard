const db = require('../db');

async function labelsForProject(projectId) {
  const { rows } = await db.query(
    'SELECT * FROM labels WHERE project_id = $1 ORDER BY name ASC',
    [projectId]
  );
  return rows;
}

async function labelsByTaskIds(taskIds) {
  if (!taskIds.length) return new Map();

  const { rows } = await db.query(
    `SELECT tl.task_id, l.id, l.name, l.color
     FROM task_labels tl
     JOIN labels l ON l.id = tl.label_id
     WHERE tl.task_id = ANY($1)
     ORDER BY l.name ASC`,
    [taskIds]
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.task_id)) map.set(row.task_id, []);
    map.get(row.task_id).push({ id: row.id, name: row.name, color: row.color });
  }
  return map;
}

function attachLabels(tasks, labelMap) {
  return tasks.map((task) => ({
    ...task,
    labels: labelMap.get(task.id) || [],
  }));
}

async function setTaskLabels(taskId, labelIds) {
  const ids = Array.isArray(labelIds) ? labelIds : [];

  const { rows: taskRows } = await db.query('SELECT id FROM tasks WHERE id = $1', [taskId]);
  if (!taskRows.length) throw new Error('Task not found.');

  if (ids.length) {
    const { rows: valid } = await db.query(
      `SELECT l.id FROM labels l
       JOIN tasks t ON t.id = $1
       JOIN columns c ON c.id = t.column_id
       JOIN boards b ON b.id = c.board_id
       WHERE l.id = ANY($2) AND l.project_id = b.project_id`,
      [taskId, ids]
    );
    if (valid.length !== ids.length) {
      throw new Error('One or more labels do not belong to this project.');
    }
  }

  await db.query('DELETE FROM task_labels WHERE task_id = $1', [taskId]);
  for (const labelId of ids) {
    await db.query(
      'INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [taskId, labelId]
    );
  }

  const map = await labelsByTaskIds([taskId]);
  return map.get(taskId) || [];
}

module.exports = {
  labelsForProject,
  labelsByTaskIds,
  attachLabels,
  setTaskLabels,
};
