const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { isCompletedColumn } = require('../lib/columns');
const {
  logActivity,
  getProjectIdForTask,
  getProjectIdForColumn,
  getColumnName,
} = require('../services/activity');
const { fireAndForget, notifyCompleted, notifyUrgent } = require('../services/notify');
const {
  enrichTask,
  autoCreateEnabled,
  isEnabled,
  defaultRepo,
  createIssueForTask,
  linkIssueToTask,
  unlinkIssue,
  syncIssueForColumnChange,
} = require('../services/github');

const router = express.Router();

// ── Projects ──────────────────────────────────────────────────────────────────

router.get('/projects', asyncHandler(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM boards b WHERE b.project_id = p.id) AS board_count
     FROM projects p
     ORDER BY p.created_at ASC`
  );
  res.json(rows);
}));

router.post('/projects', asyncHandler(async (req, res) => {
  const { name, description, color } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Project name is required.' });
  }

  const { rows } = await db.query(
    `INSERT INTO projects (name, description, color)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name.trim(), description || null, color || '#6366f1']
  );

  const project = rows[0];

  const { rows: boards } = await db.query(
    `INSERT INTO boards (project_id, name) VALUES ($1, $2) RETURNING *`,
    [project.id, 'Main Board']
  );

  const defaultColumns = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];
  for (let i = 0; i < defaultColumns.length; i++) {
    await db.query(
      `INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3)`,
      [boards[0].id, defaultColumns[i], i]
    );
  }

  res.status(201).json(project);
}));

router.use(require('./overview'));

router.get('/github/status', asyncHandler(async (_req, res) => {
  res.json({
    enabled: isEnabled(),
    default_repo: defaultRepo(),
    auto_create: autoCreateEnabled(),
  });
}));

router.get('/projects/:id', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Project not found.' });
  res.json(rows[0]);
}));

router.put('/projects/:id', asyncHandler(async (req, res) => {
  const { name, description, color } = req.body;
  const { rows } = await db.query(
    `UPDATE projects
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         color = COALESCE($3, color),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [name, description, color, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Project not found.' });
  res.json(rows[0]);
}));

router.delete('/projects/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Project not found.' });
  res.status(204).send();
}));

// ── Board (full kanban payload) ───────────────────────────────────────────────

router.get('/projects/:projectId/board', asyncHandler(async (req, res) => {
  const { rows: projects } = await db.query(
    'SELECT * FROM projects WHERE id = $1',
    [req.params.projectId]
  );
  if (!projects.length) return res.status(404).json({ error: 'Project not found.' });

  const { rows: boards } = await db.query(
    'SELECT * FROM boards WHERE project_id = $1 ORDER BY created_at ASC LIMIT 1',
    [req.params.projectId]
  );
  if (!boards.length) return res.status(404).json({ error: 'Board not found.' });

  const board = boards[0];

  const { rows: columns } = await db.query(
    'SELECT * FROM columns WHERE board_id = $1 ORDER BY position ASC',
    [board.id]
  );

  const { rows: tasks } = await db.query(
    `SELECT t.* FROM tasks t
     JOIN columns c ON c.id = t.column_id
     WHERE c.board_id = $1
     ORDER BY t.position ASC`,
    [board.id]
  );

  const columnsWithTasks = columns.map((col) => ({
    ...col,
    tasks: tasks.filter((t) => t.column_id === col.id).map(enrichTask),
  }));

  res.json({
    project: projects[0],
    board,
    columns: columnsWithTasks,
  });
}));

// ── Tasks ─────────────────────────────────────────────────────────────────────

router.post('/columns/:columnId/tasks', asyncHandler(async (req, res) => {
  const { title, description, priority, assignee, due_date, create_github_issue } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ error: 'Task title is required.' });
  }

  const { rows: maxPos } = await db.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM tasks WHERE column_id = $1',
    [req.params.columnId]
  );

  const { rows } = await db.query(
    `INSERT INTO tasks (column_id, title, description, priority, assignee, due_date, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      req.params.columnId,
      title.trim(),
      description || null,
      priority || 'medium',
      assignee || null,
      due_date || null,
      maxPos[0].next_pos,
    ]
  );

  const task = rows[0];
  const projectId = await getProjectIdForColumn(req.params.columnId);
  const columnName = await getColumnName(req.params.columnId);

  const shouldCreateIssue = create_github_issue === true
    || (create_github_issue !== false && autoCreateEnabled());

  if (shouldCreateIssue) {
    try {
      await createIssueForTask(task.id);
    } catch (err) {
      console.error('GitHub issue creation failed:', err.message);
    }
  }

  const { rows: refreshed } = await db.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  const finalTask = enrichTask(refreshed[0] || task);

  if (projectId) {
    await logActivity({
      taskId: finalTask.id,
      projectId,
      action: 'created',
      taskTitle: finalTask.title,
      toColumn: columnName,
      metadata: { priority: finalTask.priority },
    });
    if (finalTask.priority === 'urgent') {
      fireAndForget(() => notifyUrgent(finalTask.id));
    }
  }

  res.status(201).json(finalTask);
}));

router.put('/tasks/:id', asyncHandler(async (req, res) => {
  const { title, description, priority, assignee, due_date, github_issue_url } = req.body;
  const { rows: before } = await db.query(
    'SELECT priority FROM tasks WHERE id = $1',
    [req.params.id]
  );
  if (!before.length) return res.status(404).json({ error: 'Task not found.' });

  const { rows } = await db.query(
    `UPDATE tasks
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         priority = COALESCE($3, priority),
         assignee = COALESCE($4, assignee),
         due_date = COALESCE($5, due_date),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING *`,
    [title, description, priority, assignee, due_date, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Task not found.' });

  const task = rows[0];

  if (github_issue_url !== undefined) {
    if (github_issue_url === null || github_issue_url === '') {
      await unlinkIssue(task.id);
    } else {
      await linkIssueToTask(task.id, github_issue_url);
    }
  }

  const { rows: updatedRows } = await db.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  const updatedTask = enrichTask(updatedRows[0] || task);
  const projectId = await getProjectIdForTask(updatedTask.id);
  if (projectId) {
    await logActivity({
      taskId: updatedTask.id,
      projectId,
      action: 'updated',
      taskTitle: updatedTask.title,
    });
    if (updatedTask.priority === 'urgent' && before[0].priority !== 'urgent') {
      fireAndForget(() => notifyUrgent(updatedTask.id));
    }
  }

  res.json(updatedTask);
}));

router.post('/tasks/:id/github-issue', asyncHandler(async (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ error: 'GitHub integration is not configured.' });
  }

  const { github_repo } = req.body || {};
  const task = await createIssueForTask(req.params.id, github_repo);
  res.status(201).json(task);
}));

router.delete('/tasks/:id', asyncHandler(async (req, res) => {
  const projectId = await getProjectIdForTask(req.params.id);
  const { rows: taskRows } = await db.query(
    'SELECT title FROM tasks WHERE id = $1',
    [req.params.id]
  );

  const { rowCount } = await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Task not found.' });

  if (projectId && taskRows.length) {
    await logActivity({
      projectId,
      action: 'deleted',
      taskTitle: taskRows[0].title,
    });
  }

  res.status(204).send();
}));

router.patch('/tasks/:id/move', asyncHandler(async (req, res) => {
  const { column_id, position } = req.body;
  if (!column_id || position === undefined) {
    return res.status(400).json({ error: 'column_id and position are required.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: taskRows } = await client.query(
      'SELECT * FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!taskRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Task not found.' });
    }

    const task = taskRows[0];
    const oldColumn = task.column_id;

    if (oldColumn === column_id) {
      if (position < task.position) {
        await client.query(
          `UPDATE tasks SET position = position + 1
           WHERE column_id = $1 AND position >= $2 AND position < $3 AND id != $4`,
          [column_id, position, task.position, task.id]
        );
      } else if (position > task.position) {
        await client.query(
          `UPDATE tasks SET position = position - 1
           WHERE column_id = $1 AND position > $2 AND position <= $3 AND id != $4`,
          [column_id, task.position, position, task.id]
        );
      }
    } else {
      await client.query(
        `UPDATE tasks SET position = position - 1
         WHERE column_id = $1 AND position > $2`,
        [oldColumn, task.position]
      );
      await client.query(
        `UPDATE tasks SET position = position + 1
         WHERE column_id = $1 AND position >= $2`,
        [column_id, position]
      );
    }

    const { rows } = await client.query(
      `UPDATE tasks
       SET column_id = $1, position = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [column_id, position, req.params.id]
    );

    await client.query('COMMIT');

    const updatedTask = rows[0];
    const fromName = await getColumnName(oldColumn);
    const toName = await getColumnName(column_id);
    const projectId = await getProjectIdForTask(updatedTask.id);

    if (projectId) {
      const action = isCompletedColumn(toName) ? 'completed' : 'moved';
      await logActivity({
        taskId: updatedTask.id,
        projectId,
        action,
        taskTitle: updatedTask.title,
        fromColumn: fromName,
        toColumn: toName,
      });
      if (!isCompletedColumn(fromName) && isCompletedColumn(toName)) {
        fireAndForget(() => notifyCompleted(updatedTask.id, toName));
      }
      if (oldColumn !== column_id) {
        fireAndForget(() => syncIssueForColumnChange(updatedTask, fromName, toName));
      }
    }

    res.json(enrichTask(updatedTask));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ── Columns ───────────────────────────────────────────────────────────────────

router.post('/boards/:boardId/columns', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Column name is required.' });
  }

  const { rows: maxPos } = await db.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM columns WHERE board_id = $1',
    [req.params.boardId]
  );

  const { rows } = await db.query(
    `INSERT INTO columns (board_id, name, position)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [req.params.boardId, name.trim(), maxPos[0].next_pos]
  );

  res.status(201).json(rows[0]);
}));

module.exports = router;
