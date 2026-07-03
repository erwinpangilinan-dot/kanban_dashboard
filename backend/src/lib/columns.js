const BACKLOG = ['Backlog', 'To Do'];
const IN_PROGRESS = ['In Progress'];
const COMPLETED = ['Review', 'Done'];

function categoryForColumn(name) {
  if (COMPLETED.includes(name)) return 'completed';
  if (IN_PROGRESS.includes(name)) return 'in_progress';
  if (BACKLOG.includes(name)) return 'backlog';
  return 'other';
}

function isCompletedColumn(name) {
  return COMPLETED.includes(name);
}

module.exports = {
  BACKLOG,
  IN_PROGRESS,
  COMPLETED,
  categoryForColumn,
  isCompletedColumn,
};
