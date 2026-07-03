const BASE = (process.env.MISSION_CONTROL_API_URL || 'http://localhost/api').replace(/\/$/, '');

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = process.env.MISSION_CONTROL_API_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers,
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Mission Control API error ${res.status} on ${path}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function findColumnByName(projectId, columnName) {
  const board = await api(`/projects/${projectId}/board`);
  const col = board.columns.find(
    (c) => c.name.toLowerCase() === columnName.toLowerCase()
  );
  if (!col) {
    const names = board.columns.map((c) => c.name).join(', ');
    throw new Error(`Column "${columnName}" not found. Available: ${names}`);
  }
  return { board, column: col };
}

export function formatStatusReport(overview) {
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
      lines.push(`- **${t.title}** (${t.project_name}) — due ${t.due_date}, ${t.column_name}`);
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

export function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(data) {
  return textResult(JSON.stringify(data, null, 2));
}
