import type { TaskPriority } from '../types';

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; className: string; dot: string }
> = {
  low: {
    label: 'Low',
    className: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    dot: 'bg-slate-400',
  },
  medium: {
    label: 'Medium',
    className: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  high: {
    label: 'High',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  urgent: {
    label: 'Urgent',
    className: 'bg-red-500/20 text-red-300 border-red-500/30',
    dot: 'bg-red-400',
  },
};

export function formatDueDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return due < today;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
