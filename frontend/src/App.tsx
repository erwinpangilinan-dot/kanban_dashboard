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
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { getAutoRefreshEnabled, setAutoRefreshEnabled } from './lib/autoRefresh';
import { EMPTY_FILTERS, collectAssignees, filterColumns } from './lib/boardFilters';
import { clearToken, getToken } from './lib/auth';
import type { AppView, BoardData, Label, OverviewData, Project, Task, UpdateTaskInput } from './types';

type AuthState = 'loading' | 'login' | 'ready';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
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

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setUsername(null);
      setAuthState('login');
    });
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
          const me = await api.getMe();
          setUsername(me.username);
          setAuthState('ready');
        } catch {
          clearToken();
          setAuthState('login');
        }
      })
      .catch(() => setAuthState('ready'));
  }, []);

  function handleLogout() {
    clearToken();
    setUsername(null);
    setAuthState('login');
  }

  function handleLoginSuccess(name: string) {
    setUsername(name);
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

  useEffect(() => {
    if (authState !== 'ready') return;
    loadProjects().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
      setLoading(false);
    });
  }, [loadProjects, authState]);

  useEffect(() => {
    if (authState !== 'ready') return;
    if (view === 'overview') {
      loadOverview();
    } else if (activeProjectId) {
      loadBoard(activeProjectId);
    }
  }, [view, activeProjectId, loadOverview, loadBoard, authState]);

  function handleSelectOverview() {
    setView('overview');
  }

  function handleSelectWorkspace() {
    setView('workspace');
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
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        view={view}
        activeProjectId={activeProjectId}
        onSelectOverview={handleSelectOverview}
        onSelectWorkspace={handleSelectWorkspace}
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
          username={authEnabled ? username : null}
          onLogout={authEnabled ? handleLogout : undefined}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={view === 'board' ? handleAutoRefreshChange : undefined}
          onExport={view === 'board' && activeProjectId ? handleExport : undefined}
          exporting={exporting}
        />

        <main className="flex-1 overflow-auto p-6">
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
              <button
                type="button"
                onClick={() => setShowProjectModal(true)}
                className="mt-3 text-sm text-accent-hover hover:underline"
              >
                Create your first project
              </button>
            </div>
          )}
        </main>
      </div>

      {selectedTask && activeProjectId && (
        <TaskModal
          task={selectedTask}
          projectId={activeProjectId}
          projectLabels={boardData?.labels ?? []}
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
