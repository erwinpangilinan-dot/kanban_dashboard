function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function boardToCsv({ project, columns }) {
  const header = [
    'column',
    'title',
    'description',
    'priority',
    'assignee',
    'due_date',
    'labels',
    'github_issue_url',
  ];
  const lines = [header.join(',')];

  for (const col of columns) {
    for (const task of col.tasks) {
      lines.push([
        col.name,
        task.title,
        task.description,
        task.priority,
        task.assignee,
        task.due_date ? formatDate(task.due_date) : '',
        (task.labels || []).map((l) => l.name).join('; '),
        task.github_issue_url || '',
      ].map(escapeCsv).join(','));
    }
  }

  return lines.join('\n');
}

function boardToJson({ project, board, columns }) {
  return {
    exported_at: new Date().toISOString(),
    project,
    board,
    columns: columns.map((col) => ({
      name: col.name,
      tasks: col.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        assignee: task.assignee,
        due_date: formatDate(task.due_date) || null,
        labels: task.labels || [],
        github_issue_url: task.github_issue_url || null,
      })),
    })),
  };
}

module.exports = { escapeCsv, formatDate, boardToCsv, boardToJson };
