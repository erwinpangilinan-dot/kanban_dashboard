import { LayoutDashboard, Mail, Plus, Rocket } from 'lucide-react';
import type { AppView, Project } from '../types';

interface SidebarProps {
  projects: Project[];
  view: AppView;
  activeProjectId: string | null;
  onSelectOverview: () => void;
  onSelectWorkspace: () => void;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
}

export function Sidebar({
  projects,
  view,
  activeProjectId,
  onSelectOverview,
  onSelectWorkspace,
  onSelectProject,
  onCreateProject,
}: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-surface-glass backdrop-blur-xl">
      <div className="flex items-center gap-2.5 border-b border-white/5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
          <Rocket className="h-4 w-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-white">Mission Control</h1>
          <p className="text-[11px] text-gray-500">Project Dashboard</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <button
          type="button"
          onClick={onSelectOverview}
          className={`mb-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
            view === 'overview'
              ? 'bg-accent/15 font-medium text-accent-hover'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          Overview
        </button>

        <button
          type="button"
          onClick={onSelectWorkspace}
          className={`mb-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
            view === 'workspace'
              ? 'bg-accent/15 font-medium text-accent-hover'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <Mail className="h-4 w-4 shrink-0" />
          Workspace
        </button>

        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-600">
            Projects
          </span>
          <button
            type="button"
            onClick={onCreateProject}
            className="rounded p-0.5 text-gray-500 transition-colors hover:bg-surface-overlay hover:text-gray-300"
            aria-label="Create project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <ul className="space-y-0.5">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => onSelectProject(project.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  view === 'board' && activeProjectId === project.id
                    ? 'bg-accent/15 font-medium text-accent-hover'
                    : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate">{project.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
