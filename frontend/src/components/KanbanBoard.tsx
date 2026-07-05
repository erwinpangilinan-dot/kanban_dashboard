import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useEffect, useRef, useState } from 'react';
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

function resolveDropColumn(columns: Column[], over: Over): Column | undefined {
  const data = over.data.current;
  if (data?.type === 'column') return data.column as Column;
  return findColumn(columns, over.id as string);
}

export function KanbanBoard({
  columns,
  onColumnsChange,
  onMoveTask,
  onAddTask,
  onTaskClick,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const columnsRef = useRef(columns);
  const dragStartColumns = useRef(columns);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as Task | undefined;
    dragStartColumns.current = columnsRef.current;
    if (task) setActiveTask(task);
  }

  function moveTaskBetweenColumns(
    cols: Column[],
    activeId: string,
    activeColumn: Column,
    targetColumn: Column,
    overId: string
  ): Column[] {
    const activeIndex = activeColumn.tasks.findIndex((t) => t.id === activeId);
    if (activeIndex === -1) return cols;

    const activeTaskItem = activeColumn.tasks[activeIndex];
    const overIndex = targetColumn.tasks.findIndex((t) => t.id === overId);
    const insertIndex = overIndex >= 0 ? overIndex : targetColumn.tasks.length;

    return cols.map((col) => {
      if (col.id === activeColumn.id) {
        return { ...col, tasks: col.tasks.filter((t) => t.id !== activeId) };
      }
      if (col.id === targetColumn.id) {
        const newTasks = [...col.tasks];
        newTasks.splice(insertIndex, 0, { ...activeTaskItem, column_id: col.id });
        return { ...col, tasks: newTasks };
      }
      return col;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const cols = dragStartColumns.current;

    const activeColumn = findColumn(cols, activeId);
    if (!activeColumn) return;

    const targetColumn = resolveDropColumn(cols, over);
    if (!targetColumn) return;

    let nextColumns = cols;

    if (activeColumn.id === targetColumn.id) {
      const oldIndex = activeColumn.tasks.findIndex((t) => t.id === activeId);
      const newIndex = targetColumn.tasks.findIndex((t) => t.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        nextColumns = cols.map((col) => {
          if (col.id !== targetColumn.id) return col;
          return { ...col, tasks: arrayMove(col.tasks, oldIndex, newIndex) };
        });
      }
    } else {
      nextColumns = moveTaskBetweenColumns(cols, activeId, activeColumn, targetColumn, overId);
    }

    columnsRef.current = nextColumns;
    onColumnsChange(nextColumns);

    const finalColumn = findColumn(nextColumns, activeId);
    if (!finalColumn) return;

    const position = finalColumn.tasks.findIndex((t) => t.id === activeId);
    onMoveTask(activeId, finalColumn.id, position >= 0 ? position : 0);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
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

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="rotate-2 opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
