const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { fetchOverview } = require('../services/overview-data');

const router = express.Router();

router.get('/overview', asyncHandler(async (_req, res) => {
  res.json(await fetchOverview());
}));

router.get('/activity', asyncHandler(async (_req, res) => {
  const db = require('../db');
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
