const db = require('./db');

const DEFAULT_COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];

async function seed() {
  const { rows: existing } = await db.query('SELECT id FROM projects LIMIT 1');
  if (existing.length > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  const { rows: projects } = await db.query(
    `INSERT INTO projects (name, description, color)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      'Mission Control',
      'Primary project dashboard for tracking deliverables and milestones.',
      '#6366f1',
    ]
  );
  const projectId = projects[0].id;

  const { rows: boards } = await db.query(
    `INSERT INTO boards (project_id, name) VALUES ($1, $2) RETURNING id`,
    [projectId, 'Sprint Board']
  );
  const boardId = boards[0].id;

  const columnIds = [];
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    const { rows } = await db.query(
      `INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
      [boardId, DEFAULT_COLUMNS[i], i]
    );
    columnIds.push(rows[0].id);
  }

  const sampleTasks = [
    // Backlog
    { column: 0, title: 'Research competitor dashboards', priority: 'low', assignee: 'Jordan K.', due: null },
    {
      column: 0,
      title: 'Implement auth middleware',
      description: 'JWT/session auth for API routes — not yet started (Sprint 2 candidate)',
      priority: 'high',
      assignee: 'Alex M.',
      due: null,
    },
    {
      column: 0,
      title: 'Sprint 2: Slack notifications',
      description: 'Notify on Done, overdue, and urgent tasks (Sprint 2)',
      priority: 'high',
      assignee: null,
      due: '2026-07-20',
    },
    {
      column: 0,
      title: 'Sprint 2: Email daily digest',
      description: 'Daily email summary of board status (Sprint 2)',
      priority: 'medium',
      assignee: null,
      due: '2026-07-25',
    },
    {
      column: 0,
      title: 'Sprint 4: Labels, filters, export',
      description: 'Task labels, board filters, and data export (Sprint 4)',
      priority: 'medium',
      assignee: null,
      due: '2026-08-15',
    },
    {
      column: 0,
      title: 'Sprint 3: GitHub link + auto-create issues',
      description: 'Link tasks to GitHub repos and auto-create issues (Sprint 3)',
      priority: 'medium',
      assignee: null,
      due: '2026-08-05',
    },
    // To Do
    {
      column: 1,
      title: 'Set up CI/CD pipeline',
      description: 'GitHub Actions CI: migrations, API smoke test, frontend build, MCP verify, Docker build',
      priority: 'high',
      assignee: 'Alex M.',
      due: '2026-07-10',
    },
    // Done — Sprint 1 / 1b shipped; core board features implemented
    { column: 4, title: 'Define product roadmap Q3', priority: 'high', assignee: 'Alex M.', due: '2026-07-15' },
    { column: 4, title: 'Implement drag-and-drop API', priority: 'urgent', assignee: 'Jordan K.', due: '2026-07-05' },
    { column: 4, title: 'Build task detail modal', priority: 'medium', assignee: 'Sam R.', due: '2026-07-12' },
    { column: 4, title: 'Design Kanban board wireframes', priority: 'medium', assignee: 'Sam R.', due: '2026-07-08' },
    { column: 4, title: 'Project kickoff meeting', priority: 'medium', assignee: 'Team', due: '2026-06-28' },
    {
      column: 4,
      title: 'Sprint 1: Overview + metrics + Docker',
      description: 'Overview metrics, project widgets, activity feed, Docker stack (Sprint 1)',
      priority: 'high',
      assignee: null,
      due: null,
    },
    {
      column: 4,
      title: 'Sprint 1b: MCP server + Cursor skill',
      description: 'MCP server, Cursor skill, agent coordination tools (Sprint 1b)',
      priority: 'high',
      assignee: null,
      due: null,
    },
  ];

  for (let i = 0; i < sampleTasks.length; i++) {
    const task = sampleTasks[i];
    await db.query(
      `INSERT INTO tasks (column_id, title, description, priority, assignee, due_date, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        columnIds[task.column],
        task.title,
        task.description ?? null,
        task.priority,
        task.assignee,
        task.due,
        i,
      ]
    );
  }

  const { rows: secondProject } = await db.query(
    `INSERT INTO projects (name, description, color)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['Infrastructure', 'DevOps and platform reliability initiatives.', '#0ea5e9']
  );

  const { rows: secondBoard } = await db.query(
    `INSERT INTO boards (project_id, name) VALUES ($1, $2) RETURNING id`,
    [secondProject[0].id, 'Ops Board']
  );

  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    await db.query(
      `INSERT INTO columns (board_id, name, position) VALUES ($1, $2, $3)`,
      [secondBoard[0].id, DEFAULT_COLUMNS[i], i]
    );
  }

  console.log('Database seeded with sample projects and tasks.');
}

module.exports = { seed };
