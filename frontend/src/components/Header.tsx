import { LogOut, RefreshCw } from 'lucide-react';
import { AUTO_REFRESH_MS } from '../lib/autoRefresh';
import type { AppView, Project } from '../types';

interface HeaderProps {
  view: AppView;
  project: Project | null;
  taskCount: number;
  onRefresh: () => void;
  loading?: boolean;
  username?: string | null;
  onLogout?: () => void;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
}

export function Header({
  view,
  project,
  taskCount,
  onRefresh,
  loading,
  username,
  onLogout,
  autoRefresh = false,
  onAutoRefreshChange,
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
        {onAutoRefreshChange && (
          <button
            type="button"
            onClick={() => onAutoRefreshChange(!autoRefresh)}
            aria-pressed={autoRefresh}
            title={
              autoRefresh
                ? `Auto-refresh on (${AUTO_REFRESH_MS / 1000}s)`
                : 'Enable auto-refresh'
            }
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              autoRefresh
                ? 'border-accent/50 bg-accent/10 text-accent-hover'
                : 'border-surface-border text-gray-500 hover:border-accent/40 hover:text-gray-300'
            }`}
          >
            Auto
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
