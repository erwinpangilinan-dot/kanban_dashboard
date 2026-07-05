import { ExternalLink, Github, Trash2, Unlink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Task, TaskPriority } from '../types';
import { PRIORITY_CONFIG } from '../lib/utils';

interface TaskModalProps {
  task: Task;
  onClose: () => void;
  onSave: (taskId: string, data: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onTaskUpdated?: (task: Task) => void;
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export function TaskModal({ task, onClose, onSave, onDelete, onTaskUpdated }: TaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignee, setAssignee] = useState(task.assignee ?? '');
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [githubUrl, setGithubUrl] = useState(task.github_issue_url ?? '');
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.getGitHubStatus().then((s) => setGithubEnabled(s.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        assignee: assignee.trim() || null,
        due_date: dueDate || null,
        github_issue_url: githubUrl.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateIssue() {
    setCreatingIssue(true);
    try {
      const updated = await api.createGitHubIssue(task.id);
      setGithubUrl(updated.github_issue_url ?? '');
      onTaskUpdated?.(updated);
    } finally {
      setCreatingIssue(false);
    }
  }

  function handleUnlink() {
    setGithubUrl('');
  }

  async function handleDelete() {
    if (!confirm('Delete this task?')) return;
    setDeleting(true);
    try {
      await onDelete(task.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-surface-border bg-surface-raised shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <h3 className="font-semibold text-white">Task Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_CONFIG[p].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Assignee</label>
            <input
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Name"
              className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
            />
          </div>

          {githubEnabled && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500">
                <Github className="h-3.5 w-3.5" />
                GitHub Issue
              </label>
              {githubUrl ? (
                <div className="flex items-center gap-2">
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-accent hover:text-accent-hover"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{githubUrl.replace('https://github.com/', '')}</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleUnlink}
                    title="Unlink issue"
                    className="rounded-lg border border-surface-border p-2 text-gray-400 hover:text-gray-200"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/org/repo/issues/123"
                    className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handleCreateIssue}
                    disabled={creatingIssue}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-sm text-gray-300 transition-colors hover:border-accent/40 hover:text-white disabled:opacity-50"
                  >
                    <Github className="h-4 w-4" />
                    {creatingIssue ? 'Creating issue...' : 'Create GitHub issue'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-surface-border px-5 py-4">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
