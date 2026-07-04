const db = require('../db');

const COMPLETED_COLS = "('Review', 'Done')";
const BACKLOG_COLS = "('Backlog', 'To Do')";

async function fetchOverview() {
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

  return {
    metrics: {
      ...metricsRows[0],
      completed_this_week: completedWeekRows[0].count,
    },
    projects: projectWidgets,
    upcoming,
    activity,
  };
}

function formatStatusReport(overview) {
  const { metrics, projects, upcoming, activity } = overview;
  const lines = [
    '# Mission Control Status Report',
    '',
    '## Global Metrics',
    `- **Total tasks:** ${metrics.total}`,
    `- **Backlog:** ${metrics.backlog}`,
    `- **In Progress:** ${metrics.in_progress}`,
    `- **Completed** (Review + Done): ${metrics.completed}`,
    `- **Overdue:** ${metrics.overdue}`,
    `- **Due this week:** ${metrics.due_this_week}`,
    `- **Completed this week:** ${metrics.completed_this_week}`,
    '',
    '## Projects',
  ];

  for (const p of projects) {
    lines.push(
      `### ${p.name} (${p.progress_percent}% complete)`,
      `- Active: ${p.active} | In progress: ${p.in_progress} | Overdue: ${p.overdue}`,
      p.description ? `- ${p.description}` : ''
    );
  }

  lines.push('', '## Upcoming Deadlines');
  if (upcoming.length === 0) {
    lines.push('- None');
  } else {
    for (const t of upcoming.slice(0, 8)) {
      const due = t.due_date instanceof Date
        ? t.due_date.toISOString().slice(0, 10)
        : String(t.due_date).slice(0, 10);
      lines.push(`- **${t.title}** (${t.project_name}) — due ${due}, ${t.column_name}`);
    }
  }

  lines.push('', '## Recent Activity');
  if (activity.length === 0) {
    lines.push('- No recent activity');
  } else {
    for (const a of activity.slice(0, 8)) {
      const detail =
        a.action === 'moved'
          ? `${a.task_title}: ${a.from_column} → ${a.to_column}`
          : `${a.action}: ${a.task_title}`;
      lines.push(`- [${a.project_name}] ${detail}`);
    }
  }

  return lines.filter(Boolean).join('\n');
}

module.exports = { fetchOverview, formatStatusReport };
