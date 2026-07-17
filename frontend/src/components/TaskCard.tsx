import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Github, GripVertical } from 'lucide-react';
import type { Task } from '../types';
import { PRIORITY_CONFIG, formatDueDate, getInitials, isOverdue } from '../lib/utils';

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: 'task', task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priority = PRIORITY_CONFIG[task.priority];
  const dueLabel = formatDueDate(task.due_date);
  const overdue = isOverdue(task.due_date);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`glass-card group cursor-grab rounded-xl p-4 active:cursor-grabbing ${
        isDragging ? 'opacity-50 ring-2 ring-accent/50' : 'hover:border-white/20 hover:-translate-y-0.5'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 text-gray-600 opacity-40 transition-opacity group-hover:opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </span>

        <div
          role="button"
          tabIndex={0}
          onClick={() => onClick(task)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(task);
            }
          }}
          className="flex-1 text-left"
        >
          <p className="text-sm font-medium leading-snug text-gray-100">
            {task.title}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priority.className}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />
              {priority.label}
            </span>

            {dueLabel && (
              <span
                className={`inline-flex items-center gap-1 text-[11px] ${
                  overdue ? 'text-red-400' : 'text-gray-500'
                }`}
              >
                <Calendar className="h-3 w-3" />
                {dueLabel}
              </span>
            )}

            {task.github_issue_url && (
              <a
                href={task.github_issue_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent"
                title="GitHub issue"
              >
                <Github className="h-3 w-3" />
                #{task.github_issue_number}
              </a>
            )}
          </div>

          {(task.labels?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {task.labels!.map((label) => (
                <span
                  key={label.id}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: label.color }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}

          {task.assignee && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-muted text-[9px] font-bold text-accent-hover">
                {getInitials(task.assignee)}
              </div>
              <span className="text-[11px] text-gray-500">{task.assignee}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
