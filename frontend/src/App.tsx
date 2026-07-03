import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { Header } from './components/Header';
import { KanbanBoard } from './components/KanbanBoard';
import { OverviewPage } from './components/OverviewPage';
import { ProjectModal } from './components/ProjectModal';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import type { AppView, BoardData, OverviewData, Project, Task } from './types';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<AppView>('overview');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const loadBoard = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getBoard(projectId);
      setBoardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
      setLoading(false);
    });
  }, [loadProjects]);

  useEffect(() => {
    if (view === 'overview') {
      loadOverview();
    } else if (activeProjectId) {
      loadBoard(activeProjectId);
    }
  }, [view, activeProjectId, loadOverview, loadBoard]);

  function handleSelectOverview() {
    setView('overview');
  }

  function handleSelectProject(projectId: string) {
    setActiveProjectId(projectId);
    setView('board');
  }

  function handleRefresh() {
    if (view === 'overview') {
      loadOverview();
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
    api.moveTask(taskId, columnId, position).catch(() => {
      if (activeProjectId) loadBoard(activeProjectId);
    });
  }

  async function handleSaveTask(taskId: string, data: Partial<Task>) {
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

  const taskCount =
    boardData?.columns.reduce((sum, col) => sum + col.tasks.length, 0) ?? 0;

  const showSpinner =
    loading && (view === 'overview' ? !overviewData : !boardData);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        view={view}
        activeProjectId={activeProjectId}
        onSelectOverview={handleSelectOverview}
        onSelectProject={handleSelectProject}
        onCreateProject={() => setShowProjectModal(true)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          view={view}
          project={boardData?.project ?? null}
          taskCount={taskCount}
          onRefresh={handleRefresh}
          loading={loading}
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
          ) : view === 'board' && boardData ? (
            <KanbanBoard
              columns={boardData.columns}
              onColumnsChange={(columns) =>
                setBoardData((prev) => (prev ? { ...prev, columns } : prev))
              }
              onMoveTask={handleMoveTask}
              onAddTask={handleAddTask}
              onTaskClick={setSelectedTask}
            />
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

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
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
