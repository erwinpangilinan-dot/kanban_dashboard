import type { Task, TaskPriority } from '../types';

export interface BoardFilters {
  search: string;
  priority: TaskPriority | '';
  labelId: string;
  assignee: string;
}

export const EMPTY_FILTERS: BoardFilters = {
  search: '',
  priority: '',
  labelId: '',
  assignee: '',
};

export function taskMatchesFilters(task: Task, filters: BoardFilters): boolean {
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const hay = `${task.title} ${task.description ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.labelId && !(task.labels || []).some((l) => l.id === filters.labelId)) return false;
  if (filters.assignee && (task.assignee ?? '') !== filters.assignee) return false;
  return true;
}

export function filterColumns<T extends { tasks: Task[] }>(
  columns: T[],
  filters: BoardFilters
): T[] {
  const active = filters.search || filters.priority || filters.labelId || filters.assignee;
  if (!active) return columns;
  return columns.map((col) => ({
    ...col,
    tasks: col.tasks.filter((t) => taskMatchesFilters(t, filters)),
  }));
}

export function collectAssignees(columns: { tasks: Task[] }[]): string[] {
  const names = new Set<string>();
  for (const col of columns) {
    for (const task of col.tasks) {
      if (task.assignee?.trim()) names.add(task.assignee.trim());
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
