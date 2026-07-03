import { LogOut, RefreshCw } from 'lucide-react';
import type { AppView, Project } from '../types';

interface HeaderProps {
  view: AppView;
  project: Project | null;
  taskCount: number;
  onRefresh: () => void;
  loading?: boolean;
  username?: string | null;
  onLogout?: () => void;
}

export function Header({
  view,
  project,
  taskCount,
  onRefresh,
  loading,
  username,
  onLogout,
}: HeaderProps) {
  const title = view === 'overview' ? 'Overview' : (project?.name ?? 'Board');
  const subtitle =
    view === 'overview'
      ? 'Mission status across all projects'
      : project?.description;

  return (
    <header className="flex items-center justify-between border-b border-surface-border bg-surface-raised/80 px-6 py-4 backdrop-blur-sm">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-4">
        {view === 'board' && (
          <span className="text-sm text-gray-500">
            {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
          </span>
        )}
        {username && (
          <span className="text-sm text-gray-500">{username}</span>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-surface-border p-2 text-gray-400 transition-colors hover:border-accent/40 hover:text-accent-hover"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-surface-border p-2 text-gray-400 transition-colors hover:border-accent/40 hover:text-accent-hover disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </header>
  );
}
