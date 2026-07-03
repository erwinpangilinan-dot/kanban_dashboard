import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useState } from 'react';
import type { Column, Task } from '../types';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  columns: Column[];
  onColumnsChange: (columns: Column[]) => void;
  onMoveTask: (taskId: string, columnId: string, position: number) => void;
  onAddTask: (columnId: string, title: string) => Promise<void>;
  onTaskClick: (task: Task) => void;
}

function findColumn(columns: Column[], id: string): Column | undefined {
  if (columns.some((c) => c.id === id)) {
    return columns.find((c) => c.id === id);
  }
  return columns.find((c) => c.tasks.some((t) => t.id === id));
}

export function KanbanBoard({
  columns,
  onColumnsChange,
  onMoveTask,
  onAddTask,
  onTaskClick,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) setActiveTask(task);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findColumn(columns, activeId);
    const overColumn = findColumn(columns, overId);
    if (!activeColumn || !overColumn || activeColumn.id === overColumn.id) return;

    const activeIndex = activeColumn.tasks.findIndex((t) => t.id === activeId);
    const activeTaskItem = activeColumn.tasks[activeIndex];

    const overIndex = overColumn.tasks.findIndex((t) => t.id === overId);
    const insertIndex = overIndex >= 0 ? overIndex : overColumn.tasks.length;

    onColumnsChange(
      columns.map((col) => {
        if (col.id === activeColumn.id) {
          return { ...col, tasks: col.tasks.filter((t) => t.id !== activeId) };
        }
        if (col.id === overColumn.id) {
          const newTasks = [...col.tasks];
          newTasks.splice(insertIndex, 0, { ...activeTaskItem, column_id: col.id });
          return { ...col, tasks: newTasks };
        }
        return col;
      })
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findColumn(columns, activeId);
    if (!activeColumn) return;

    const targetColumn = findColumn(columns, overId);
    if (!targetColumn) return;

    let nextColumns = columns;

    if (activeColumn.id === targetColumn.id) {
      const oldIndex = activeColumn.tasks.findIndex((t) => t.id === activeId);
      const newIndex = targetColumn.tasks.findIndex((t) => t.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        nextColumns = columns.map((col) => {
          if (col.id !== targetColumn.id) return col;
          return { ...col, tasks: arrayMove(col.tasks, oldIndex, newIndex) };
        });
        onColumnsChange(nextColumns);
      }
    }

    const finalColumn = findColumn(nextColumns, activeId)!;
    const position = finalColumn.tasks.findIndex((t) => t.id === activeId);
    onMoveTask(activeId, finalColumn.id, position >= 0 ? position : 0);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            onTaskClick={onTaskClick}
            onAddTask={onAddTask}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rotate-2 opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
