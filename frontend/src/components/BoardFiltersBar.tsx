import type { BoardFilters } from '../lib/boardFilters';
import type { Label } from '../types';

interface BoardFiltersBarProps {
  filters: BoardFilters;
  labels: Label[];
  assignees: string[];
  onChange: (filters: BoardFilters) => void;
}

export function BoardFiltersBar({ filters, labels, assignees, onChange }: BoardFiltersBarProps) {
  function update(patch: Partial<BoardFilters>) {
    onChange({ ...filters, ...patch });
  }

  const active = filters.search || filters.priority || filters.labelId || filters.assignee;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
        placeholder="Search tasks..."
        className="min-w-[160px] flex-1 rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent sm:max-w-xs"
      />

      <select
        value={filters.priority}
        onChange={(e) => update({ priority: e.target.value as BoardFilters['priority'] })}
        className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
      >
        <option value="">All priorities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="urgent">Urgent</option>
      </select>

      <select
        value={filters.labelId}
        onChange={(e) => update({ labelId: e.target.value })}
        className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
      >
        <option value="">All labels</option>
        {labels.map((label) => (
          <option key={label.id} value={label.id}>
            {label.name}
          </option>
        ))}
      </select>

      <select
        value={filters.assignee}
        onChange={(e) => update({ assignee: e.target.value })}
        className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
      >
        <option value="">All assignees</option>
        {assignees.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {active && (
        <button
          type="button"
          onClick={() => onChange({ search: '', priority: '', labelId: '', assignee: '' })}
          className="rounded-lg border border-surface-border px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
        >
          Clear
        </button>
      )}
    </div>
  );
}
