import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api/client';
import { Header } from './components/Header';
import { BoardFiltersBar } from './components/BoardFiltersBar';
import { KanbanBoard } from './components/KanbanBoard';
import { LoginPage } from './components/LoginPage';
import { OverviewPage } from './components/OverviewPage';
import { ProjectModal } from './components/ProjectModal';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { WorkspacePage } from './components/WorkspacePage';
import { MemoriaPage } from './components/MemoriaPage';
import { NetworkPage } from './components/NetworkPage';
import { UsersPage } from './components/UsersPage';

import { useAutoRefresh } from './hooks/useAutoRefresh';
import { getAutoRefreshEnabled, setAutoRefreshEnabled } from './lib/autoRefresh';
import { EMPTY_FILTERS, collectAssignees, filterColumns } from './lib/boardFilters';
import { clearToken, getToken } from './lib/auth';
import type {
  AppView,
  BoardData,
  CurrentUser,
  Label,
  OverviewData,
  Project,
  Task,
  UpdateTaskInput,
} from './types';

type AuthState = 'loading' | 'login' | 'ready';

const ALL_VIEWS: AppView[] = ['overview', 'board', 'workspace', 'memoria', 'network', 'users'];

// Order the sidebar renders them in, so a user whose Overview tab is revoked
// lands on their first granted tab rather than an empty screen.
const VIEW_ORDER: AppView[] = ['overview', 'workspace', 'memoria', 'network', 'users', 'board'];

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<AppView>('overview');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(getAutoRefreshEnabled);
  const [boardFilters, setBoardFilters] = useState(EMPTY_FILTERS);
  const [exporting, setExporting] = useState(false);
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [networkRefresh, setNetworkRefresh] = useState(0);
  const [usersRefresh, setUsersRefresh] = useState(0);
  const [requestedView, setRequestedView] = useState<AppView | null>(null);

  // With auth disabled there is no account to read permissions from, so the
  // local operator gets everything. The API applies the same rule.
  const allowedViews = authEnabled ? (me?.views ?? []) : ALL_VIEWS;
  const canWrite = authEnabled ? (me?.can_write ?? false) : true;

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setMe(null);
      setAuthState('login');
    });
  }, []);

  // Deep-link from Google OAuth callback: /?view=workspace&oauth=ok|error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deepView = params.get('view');
    const oauth = params.get('oauth');
    // Applied once permissions are known, so a link cannot open a revoked tab.
    if (deepView && (ALL_VIEWS as string[]).includes(deepView)) {
      setRequestedView(deepView as AppView);
    }
    if (oauth) {
      sessionStorage.setItem(
        'mc_oauth_result',
        JSON.stringify({ status: oauth, message: params.get('message') })
      );
      if (oauth === 'ok') setWorkspaceRefresh((n) => n + 1);
    }
    if (deepView || oauth) {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      url.searchParams.delete('oauth');
      url.searchParams.delete('message');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

  useEffect(() => {
    api
      .getAuthStatus()
      .then(async ({ enabled }) => {
        setAuthEnabled(enabled);
        if (!enabled) {
          setAuthState('ready');
          return;
        }
        if (!getToken()) {
          setAuthState('login');
          return;
        }
        try {
          setMe(await api.getMe());
          setAuthState('ready');
        } catch {
          clearToken();
          setAuthState('login');
        }
      })
      .catch(() => setAuthState('ready'));
  }, []);

  // Keep the open tab within what the account is allowed to see. Runs on sign-in
  // and again if an admin revokes a tab while the user is on it.
  useEffect(() => {
    if (authState !== 'ready' || allowedViews.length === 0) return;

    if (requestedView) {
      setRequestedView(null);
      if (allowedViews.includes(requestedView)) {
        setView(requestedView);
        return;
      }
    }

    if (!allowedViews.includes(view)) {
      setView(VIEW_ORDER.find((candidate) => allowedViews.includes(candidate)) ?? 'overview');
    }
  }, [authState, allowedViews, requestedView, view]);

  function handleLogout() {
    clearToken();
    setMe(null);
    setAuthState('login');
  }

  function handleLoginSuccess(user: CurrentUser) {
    setMe(user);
    setAuthState('ready');
  }

  const loadProjects = useCallback(async () => {
    const data = await api.getProjects();
    setProjects(data);
    return data;
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getOverview();
      setOverviewData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBoard = useCallback(async (projectId: string, silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await api.getBoard(projectId);
      setBoardData(data);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load board');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const silentRefreshBoard = useCallback(() => {
    if (activeProjectId) loadBoard(activeProjectId, true);
  }, [activeProjectId, loadBoard]);

  useAutoRefresh(
    autoRefresh,
    view === 'board' && !!activeProjectId && !selectedTask,
    silentRefreshBoard
  );

  function handleAutoRefreshChange(enabled: boolean) {
    setAutoRefreshEnabled(enabled);
    setAutoRefresh(enabled);
    if (enabled && activeProjectId) silentRefreshBoard();
  }

  const canViewBoard = allowedViews.includes('board');

  useEffect(() => {
    if (authState !== 'ready' || !canViewBoard) {
      setLoading(false);
      return;
    }
    loadProjects().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
      setLoading(false);
    });
  }, [loadProjects, authState, canViewBoard]);

  useEffect(() => {
    if (authState !== 'ready') return;
    if (view === 'overview') {
      loadOverview();
    } else if (view === 'board' && activeProjectId) {
      loadBoard(activeProjectId);
    }
  }, [view, activeProjectId, loadOverview, loadBoard, authState]);

  function handleSelectView(next: AppView) {
    setView(next);
  }

  function handleSelectProject(projectId: string) {
    setBoardFilters(EMPTY_FILTERS);
    setActiveProjectId(projectId);
    setView('board');
  }

  function handleRefresh() {
    if (view === 'overview') {
      loadOverview();
    } else if (view === 'workspace') {
      setWorkspaceRefresh((n) => n + 1);
    } else if (view === 'network') {
      setNetworkRefresh((n) => n + 1);
    } else if (view === 'users') {
      setUsersRefresh((n) => n + 1);
    } else if (activeProjectId) {
      loadBoard(activeProjectId);
    }
  }

  async function handleCreateProject(data: {
    name: string;
    description?: string;
    color?: string;
  }) {
    const project = await api.createProject(data);
    await loadProjects();
    handleSelectProject(project.id);
  }

  async function handleAddTask(columnId: string, title: string) {
    const task = await api.createTask(columnId, { title });
    setBoardData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) =>
          col.id === columnId ? { ...col, tasks: [...col.tasks, task] } : col
        ),
      };
    });
  }

  function handleMoveTask(taskId: string, columnId: string, position: number) {
    const hasFilters =
      boardFilters.search || boardFilters.priority || boardFilters.labelId || boardFilters.assignee;
    api
      .moveTask(taskId, columnId, position)
      .then(() => {
        if (hasFilters && activeProjectId) loadBoard(activeProjectId, true);
      })
      .catch(() => {
        if (activeProjectId) loadBoard(activeProjectId);
      });
  }

  async function handleSaveTask(taskId: string, data: UpdateTaskInput) {
    const updated = await api.updateTask(taskId, data);
    setBoardData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => ({
          ...col,
          tasks: col.tasks.map((t) => (t.id === taskId ? updated : t)),
        })),
      };
    });
    setSelectedTask((prev) => (prev?.id === taskId ? updated : prev));
  }

  function handleTaskUpdated(task: Task) {
    setBoardData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => ({
          ...col,
          tasks: col.tasks.map((t) => (t.id === task.id ? task : t)),
        })),
      };
    });
    setSelectedTask(task);
  }

  async function handleDeleteTask(taskId: string) {
    await api.deleteTask(taskId);
    setBoardData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => ({
          ...col,
          tasks: col.tasks.filter((t) => t.id !== taskId),
        })),
      };
    });
  }

  function handleLabelCreated(label: Label) {
    setBoardData((prev) => {
      if (!prev) return prev;
      return { ...prev, labels: [...(prev.labels ?? []), label] };
    });
  }

  async function handleExport(format: 'csv' | 'json') {
    if (!activeProjectId) return;
    setExporting(true);
    try {
      await api.exportBoard(activeProjectId, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const filteredColumns = boardData
    ? filterColumns(boardData.columns, boardFilters)
    : [];

  const visibleTaskCount = filteredColumns.reduce((sum, col) => sum + col.tasks.length, 0);
  const totalTaskCount = boardData?.columns.reduce((sum, col) => sum + col.tasks.length, 0) ?? 0;
  const assignees = boardData ? collectAssignees(boardData.columns) : [];

  const showSpinner =
    loading && (view === 'overview' ? !overviewData : view === 'board' ? !boardData : false);

  if (authState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (authState === 'login') {
    return <LoginPage onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface relative">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full bg-accent/20 blur-[150px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-purple-500/15 blur-[150px]" />
      <div className="pointer-events-none absolute left-1/3 top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-blue-500/10 blur-[150px]" />

      <Sidebar
        projects={projects}
        view={view}
        activeProjectId={activeProjectId}
        allowedViews={allowedViews}
        canWrite={canWrite}
        onSelectView={handleSelectView}
        onSelectProject={handleSelectProject}
        onCreateProject={() => setShowProjectModal(true)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          view={view}
          project={boardData?.project ?? null}
          taskCount={visibleTaskCount}
          onRefresh={handleRefresh}
          loading={loading}
          username={authEnabled ? (me?.username ?? null) : null}
          onLogout={authEnabled ? handleLogout : undefined}
          readOnly={authEnabled && !canWrite}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={view === 'board' ? handleAutoRefreshChange : undefined}
          onExport={view === 'board' && activeProjectId ? handleExport : undefined}
          exporting={exporting}
        />

        <main className={`flex-1 overflow-auto ${view === 'memoria' ? 'p-0' : 'p-6'}`}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
              <p className="mt-1 text-xs text-red-400/70">
                Make sure the stack is running: docker compose up -d
              </p>
            </div>
          )}

          {showSpinner ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : view === 'overview' && overviewData ? (
            <OverviewPage
              data={overviewData}
              onSelectProject={handleSelectProject}
            />
          ) : view === 'workspace' ? (
            <WorkspacePage refreshToken={workspaceRefresh} />
          ) : view === 'memoria' ? (
            <MemoriaPage />
          ) : view === 'network' ? (
            <NetworkPage refreshToken={networkRefresh} canWrite={canWrite} />
          ) : view === 'users' ? (
            <UsersPage currentUsername={me?.username ?? null} refreshToken={usersRefresh} />
          ) : view === 'board' && boardData ? (

            <>
              <BoardFiltersBar
                filters={boardFilters}
                labels={boardData.labels ?? []}
                assignees={assignees}
                onChange={setBoardFilters}
              />
              {visibleTaskCount < totalTaskCount && (
                <p className="mb-3 text-xs text-gray-500">
                  Showing {visibleTaskCount} of {totalTaskCount} tasks
                </p>
              )}
              <KanbanBoard
                columns={filteredColumns}
                canWrite={canWrite}
                onColumnsChange={(columns) => {
                  if (!boardFilters.search && !boardFilters.priority && !boardFilters.labelId && !boardFilters.assignee) {
                    setBoardData((prev) => (prev ? { ...prev, columns } : prev));
                  }
                }}
                onMoveTask={handleMoveTask}
                onAddTask={handleAddTask}
                onTaskClick={setSelectedTask}
              />
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-gray-500">
              <p>No data available</p>
              {canWrite && canViewBoard && (
                <button
                  type="button"
                  onClick={() => setShowProjectModal(true)}
                  className="mt-3 text-sm text-accent-hover hover:underline"
                >
                  Create your first project
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      {selectedTask && activeProjectId && (
        <TaskModal
          task={selectedTask}
          projectId={activeProjectId}
          projectLabels={boardData?.labels ?? []}
          canWrite={canWrite}
          onClose={() => setSelectedTask(null)}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onTaskUpdated={handleTaskUpdated}
          onLabelCreated={handleLabelCreated}
        />
      )}

      {showProjectModal && (
        <ProjectModal
          onClose={() => setShowProjectModal(false)}
          onSubmit={handleCreateProject}
        />
      )}
    </div>
  );
}
