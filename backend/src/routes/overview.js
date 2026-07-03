const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const COMPLETED_COLS = "('Review', 'Done')";
const BACKLOG_COLS = "('Backlog', 'To Do')";

router.get('/overview', asyncHandler(async (_req, res) => {
  const { rows: metricsRows } = await db.query(`
    SELECT
      COUNT(t.id)::int AS total,
      COUNT(t.id) FILTER (WHERE c.name IN ${BACKLOG_COLS})::int AS backlog,
      COUNT(t.id) FILTER (WHERE c.name = 'In Progress')::int AS in_progress,
      COUNT(t.id) FILTER (WHERE c.name IN ${COMPLETED_COLS})::int AS completed,
      COUNT(t.id) FILTER (
        WHERE t.due_date < CURRENT_DATE AND c.name NOT IN ${COMPLETED_COLS}
      )::int AS overdue,
      COUNT(t.id) FILTER (
        WHERE t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND c.name NOT IN ${COMPLETED_COLS}
      )::int AS due_this_week
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
  `);

  const { rows: completedWeekRows } = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM task_activity
    WHERE action = 'completed'
      AND created_at >= NOW() - INTERVAL '7 days'
  `);

  const { rows: projects } = await db.query(`
    SELECT
      p.id,
      p.name,
      p.description,
      p.color,
      COUNT(t.id)::int AS total,
      COUNT(t.id) FILTER (WHERE c.name IN ${COMPLETED_COLS})::int AS completed,
      COUNT(t.id) FILTER (WHERE c.name NOT IN ${COMPLETED_COLS})::int AS active,
      COUNT(t.id) FILTER (
        WHERE t.due_date < CURRENT_DATE AND c.name NOT IN ${COMPLETED_COLS}
      )::int AS overdue,
      COUNT(t.id) FILTER (WHERE c.name = 'In Progress')::int AS in_progress
    FROM projects p
    LEFT JOIN boards b ON b.project_id = p.id
    LEFT JOIN columns c ON c.board_id = b.id
    LEFT JOIN tasks t ON t.column_id = c.id
    GROUP BY p.id
    ORDER BY p.created_at ASC
  `);

  const projectWidgets = projects.map((p) => ({
    ...p,
    progress_percent: p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0,
  }));

  const { rows: upcoming } = await db.query(`
    SELECT
      t.id,
      t.title,
      t.due_date,
      t.priority,
      t.assignee,
      c.name AS column_name,
      p.id AS project_id,
      p.name AS project_name,
      p.color AS project_color
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    JOIN boards b ON b.id = c.board_id
    JOIN projects p ON p.id = b.project_id
    WHERE t.due_date IS NOT NULL
      AND c.name NOT IN ${COMPLETED_COLS}
    ORDER BY t.due_date ASC
    LIMIT 10
  `);

  const { rows: activity } = await db.query(`
    SELECT
      a.id,
      a.action,
      a.task_title,
      a.from_column,
      a.to_column,
      a.created_at,
      p.name AS project_name,
      p.color AS project_color
    FROM task_activity a
    LEFT JOIN projects p ON p.id = a.project_id
    ORDER BY a.created_at DESC
    LIMIT 20
  `);

  res.json({
    metrics: {
      ...metricsRows[0],
      completed_this_week: completedWeekRows[0].count,
    },
    projects: projectWidgets,
    upcoming,
    activity,
  });
}));

router.get('/activity', asyncHandler(async (_req, res) => {
  const { rows } = await db.query(`
    SELECT
      a.id,
      a.action,
      a.task_title,
      a.from_column,
      a.to_column,
      a.created_at,
      p.name AS project_name,
      p.color AS project_color
    FROM task_activity a
    LEFT JOIN projects p ON p.id = a.project_id
    ORDER BY a.created_at DESC
    LIMIT 50
  `);
  res.json(rows);
}));

module.exports = router;
