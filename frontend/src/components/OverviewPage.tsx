import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Inbox,
  Layers,
  TrendingUp,
} from 'lucide-react';
import type { OverviewData } from '../types';
import { PRIORITY_CONFIG, formatDueDate, isOverdue } from '../lib/utils';

interface OverviewPageProps {
  data: OverviewData;
  onSelectProject: (projectId: string) => void;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          {label}
        </span>
        <div className={`rounded-lg p-2 ${accent ?? 'bg-accent/15'}`}>
          <Icon className={`h-4 w-4 ${accent ? 'text-current' : 'text-accent-hover'}`} />
        </div>
      </div>
      <p className="mt-3 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function ProjectWidget({
  project,
  onClick,
}: {
  project: OverviewData['projects'][0];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-surface-border bg-surface-raised p-5 text-left shadow-card transition-all hover:border-accent/40 hover:shadow-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <h3 className="font-semibold text-white">{project.name}</h3>
        </div>
        <span className="text-sm font-bold text-accent-hover">
          {project.progress_percent}%
        </span>
      </div>

      {project.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-gray-500">{project.description}</p>
      )}

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${project.progress_percent}%`,
            backgroundColor: project.color,
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
        <span>{project.active} active</span>
        <span>{project.in_progress} in progress</span>
        {project.overdue > 0 && (
          <span className="text-red-400">{project.overdue} overdue</span>
        )}
      </div>
    </button>
  );
}

function activityLabel(item: OverviewData['activity'][0]): string {
  switch (item.action) {
    case 'created':
      return `created "${item.task_title}" in ${item.to_column}`;
    case 'completed':
      return `completed "${item.task_title}"`;
    case 'moved':
      return `moved "${item.task_title}" from ${item.from_column} → ${item.to_column}`;
    case 'updated':
      return `updated "${item.task_title}"`;
    case 'deleted':
      return `deleted "${item.task_title}"`;
    default:
      return item.task_title ?? item.action;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function OverviewPage({ data, onSelectProject }: OverviewPageProps) {
  const { metrics, projects, upcoming, activity } = data;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">
          Mission Status
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
          <MetricCard label="Total" value={metrics.total} icon={Layers} />
          <MetricCard label="Backlog" value={metrics.backlog} icon={Inbox} />
          <MetricCard label="In Progress" value={metrics.in_progress} icon={Clock} />
          <MetricCard
            label="Completed"
            value={metrics.completed}
            icon={CheckCircle2}
            accent="bg-green-500/15 text-green-400"
          />
          <MetricCard
            label="Overdue"
            value={metrics.overdue}
            icon={AlertTriangle}
            accent="bg-red-500/15 text-red-400"
          />
          <MetricCard label="Due This Week" value={metrics.due_this_week} icon={Calendar} />
          <MetricCard
            label="Done This Week"
            value={metrics.completed_this_week}
            icon={TrendingUp}
            accent="bg-emerald-500/15 text-emerald-400"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">
          Projects
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectWidget
              key={p.id}
              project={p}
              onClick={() => onSelectProject(p.id)}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-surface-border bg-surface-raised p-5">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">
            Upcoming Deadlines
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-600">No upcoming deadlines.</p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((task) => {
                const overdue = isOverdue(task.due_date);
                const priority = PRIORITY_CONFIG[task.priority];
                return (
                  <li
                    key={task.id}
                    className="flex items-start justify-between gap-3 border-b border-surface-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-200">
                        {task.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {task.project_name} · {task.column_name}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-xs font-medium ${overdue ? 'text-red-400' : 'text-gray-400'}`}>
                        {formatDueDate(task.due_date)}
                      </p>
                      <span className={`text-[10px] ${priority.className.split(' ')[1]}`}>
                        {priority.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-surface-border bg-surface-raised p-5">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">
            Recent Activity
          </h2>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-600">No activity yet. Move a task to get started.</p>
          ) : (
            <ul className="space-y-3">
              {activity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 border-b border-surface-border/60 pb-3 last:border-0 last:pb-0"
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.project_color ?? '#6366f1' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-300">{activityLabel(item)}</p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {item.project_name} · {timeAgo(item.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
