import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { Column, Task } from '../types';
import { TaskCard } from './TaskCard';

interface KanbanColumnProps {
  column: Column;
  onTaskClick: (task: Task) => void;
  onAddTask: (columnId: string, title: string) => Promise<void>;
}

export function KanbanColumn({ column, onTaskClick, onAddTask }: KanbanColumnProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ponytail: stop dnd-kit from swallowing clicks on column controls
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', column },
  });

  const taskIds = column.tasks.map((t) => t.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAddTask(column.id, title.trim());
      setTitle('');
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-200">{column.name}</h3>
          <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-xs font-medium text-gray-500">
            {column.tasks.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => { setAdding(true); setError(null); }}
          onPointerDown={stopDrag}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-surface-overlay hover:text-gray-300"
          aria-label={`Add task to ${column.name}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-[200px] flex-1 flex-col gap-3 rounded-2xl border p-3 transition-colors ${
          isOver
            ? 'border-accent/50 bg-accent/5'
            : 'border-white/5 bg-surface-glass/40'
        }`}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} />
          ))}
        </SortableContext>

        {adding && (
          <form onSubmit={handleSubmit} className="mt-1" onPointerDown={stopDrag}>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setAdding(false);
                  setTitle('');
                  setError(null);
                }
              }}
              placeholder="Task title..."
              className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-accent"
            />
            {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={!title.trim() || submitting}
                onPointerDown={stopDrag}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {submitting ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setTitle(''); setError(null); }}
                onPointerDown={stopDrag}
                className="rounded-md px-3 py-1 text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
