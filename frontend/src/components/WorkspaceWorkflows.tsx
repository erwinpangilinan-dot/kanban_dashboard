import { useEffect, useState } from 'react';
import {
  Zap,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Kanban,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  EmailWorkflow,
  CreateEmailWorkflowInput,
  EmailWorkflowLog,
  Project,
} from '../types';

export function WorkspaceWorkflows() {
  const [workflows, setWorkflows] = useState<EmailWorkflow[]>([]);
  const [logs, setLogs] = useState<EmailWorkflowLog[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingWf, setEditingWf] = useState<EmailWorkflow | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerCategory, setTriggerCategory] = useState<string>('any');
  const [triggerSender, setTriggerSender] = useState('');
  const [triggerKeyword, setTriggerKeyword] = useState('');
  const [actionCreateTask, setActionCreateTask] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskTitleTemplate, setTaskTitleTemplate] = useState('');
  const [actionAutoReply, setActionAutoReply] = useState(false);
  const [replyTemplate, setReplyTemplate] = useState('');
  const [actionNotifyTelegram, setActionNotifyTelegram] = useState(false);
  const [actionTrashEmail, setActionTrashEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [wfList, logList, overviewData] = await Promise.all([
        api.getEmailWorkflows(),
        api.getEmailWorkflowLogs(30),
        api.getOverview(),
      ]);
      setWorkflows(wfList);
      setLogs(logList);
      setProjects(overviewData.projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        color: p.color,
        created_at: '',
        updated_at: '',
      })));
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateModal = () => {
    setEditingWf(null);
    setName('');
    setDescription('');
    setTriggerCategory('any');
    setTriggerSender('');
    setTriggerKeyword('');
    setActionCreateTask(false);
    setTaskProjectId('');
    setTaskTitleTemplate('Email: {{subject}}');
    setActionAutoReply(false);
    setReplyTemplate('');
    setActionNotifyTelegram(false);
    setActionTrashEmail(false);
    setShowModal(true);
  };

  const openEditModal = (wf: EmailWorkflow) => {
    setEditingWf(wf);
    setName(wf.name);
    setDescription(wf.description || '');
    setTriggerCategory(wf.trigger_category || 'any');
    setTriggerSender(wf.trigger_sender || '');
    setTriggerKeyword(wf.trigger_keyword || '');
    setActionCreateTask(wf.action_create_task);
    setTaskProjectId(wf.task_project_id || '');
    setTaskTitleTemplate(wf.task_title_template || 'Email: {{subject}}');
    setActionAutoReply(wf.action_auto_reply);
    setReplyTemplate(wf.reply_template || '');
    setActionNotifyTelegram(wf.action_notify_telegram);
    setActionTrashEmail(wf.action_trash_email);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setSubmitting(true);
      const payload: CreateEmailWorkflowInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        is_active: editingWf ? editingWf.is_active : true,
        trigger_category: triggerCategory,
        trigger_sender: triggerSender.trim() || undefined,
        trigger_keyword: triggerKeyword.trim() || undefined,
        action_create_task: actionCreateTask,
        task_project_id: actionCreateTask && taskProjectId ? taskProjectId : undefined,
        task_title_template: actionCreateTask && taskTitleTemplate.trim() ? taskTitleTemplate.trim() : undefined,
        action_auto_reply: actionAutoReply,
        reply_template: actionAutoReply && replyTemplate.trim() ? replyTemplate.trim() : undefined,
        action_notify_telegram: actionNotifyTelegram,
        action_trash_email: actionTrashEmail,
      };

      if (editingWf) {
        await api.updateEmailWorkflow(editingWf.id, payload);
      } else {
        await api.createEmailWorkflow(payload);
      }

      setShowModal(false);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to save workflow rule.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (wf: EmailWorkflow) => {
    try {
      await api.updateEmailWorkflow(wf.id, { is_active: !wf.is_active });
      setWorkflows((prev) =>
        prev.map((item) => (item.id === wf.id ? { ...item, is_active: !item.is_active } : item))
      );
    } catch (err: any) {
      alert(err.message || 'Failed to update rule status.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workflow rule?')) return;
    try {
      await api.deleteEmailWorkflow(id);
      setWorkflows((prev) => prev.filter((wf) => wf.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete rule.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-accent" />
            <h2 className="text-xl font-bold text-white">Email Automation Workflows</h2>
          </div>
          <p className="text-sm text-gray-400">
            Configure automated rules for the Email Agent to execute task creation, notifications, auto-replies, and cleanup.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover shadow-lg shadow-accent/20"
        >
          <Plus className="h-4 w-4" />
          Create Automation Rule
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Filter className="h-4 w-4 text-accent" />
            Active Automation Rules ({workflows.filter((w) => w.is_active).length}/{workflows.length})
          </h3>
        </div>

        {loading ? (
          <div className="rounded-xl border border-surface-border bg-surface-card p-8 text-center text-sm text-gray-400">
            Loading workflow rules...
          </div>
        ) : workflows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-border bg-surface-card/50 p-8 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-accent/60" />
            <h4 className="mt-3 text-base font-semibold text-white">No automation rules created</h4>
            <p className="mt-1 text-sm text-gray-400">
              Create your first workflow rule to automatically process incoming emails.
            </p>
            <button
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20"
            >
              <Plus className="h-4 w-4" />
              Add Rule
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className={`relative flex flex-col justify-between rounded-xl border p-5 transition-all ${
                  wf.is_active
                    ? 'border-surface-border bg-surface-card hover:border-accent/40 shadow-sm'
                    : 'border-surface-border/50 bg-surface-card/40 opacity-70'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-white">{wf.name}</h4>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            wf.is_active
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                          }`}
                        >
                          {wf.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      {wf.description && (
                        <p className="mt-1 text-xs text-gray-400">{wf.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(wf)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                          wf.is_active ? 'bg-accent' : 'bg-surface-border'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            wf.is_active ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Trigger criteria badges */}
                  <div className="mt-4 rounded-lg bg-black/20 p-3 text-xs space-y-1.5 border border-white/5">
                    <span className="font-semibold text-gray-300 block mb-1">Triggers When:</span>
                    {wf.trigger_category && wf.trigger_category !== 'any' && (
                      <div className="flex items-center gap-1.5 text-gray-300">
                        <span className="text-gray-500">Category:</span>
                        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-accent-hover font-mono">
                          {wf.trigger_category}
                        </span>
                      </div>
                    )}
                    {wf.trigger_sender && (
                      <div className="flex items-center gap-1.5 text-gray-300">
                        <span className="text-gray-500">Sender contains:</span>
                        <span className="rounded bg-surface-border px-1.5 py-0.5 font-mono text-white">
                          "{wf.trigger_sender}"
                        </span>
                      </div>
                    )}
                    {wf.trigger_keyword && (
                      <div className="flex items-center gap-1.5 text-gray-300">
                        <span className="text-gray-500">Keyword contains:</span>
                        <span className="rounded bg-surface-border px-1.5 py-0.5 font-mono text-white">
                          "{wf.trigger_keyword}"
                        </span>
                      </div>
                    )}
                    {!wf.trigger_sender && !wf.trigger_keyword && wf.trigger_category === 'any' && (
                      <div className="text-gray-400 italic">Triggers on all incoming emails</div>
                    )}
                  </div>

                  {/* Actions badges */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {wf.action_create_task && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-300 border border-blue-500/20">
                        <Kanban className="h-3 w-3" /> Create Task
                      </span>
                    )}
                    {wf.action_auto_reply && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-1 text-xs font-medium text-purple-300 border border-purple-500/20">
                        <Send className="h-3 w-3" /> Auto Reply
                      </span>
                    )}
                    {wf.action_notify_telegram && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-teal-500/10 px-2 py-1 text-xs font-medium text-teal-300 border border-teal-500/20">
                        <MessageSquare className="h-3 w-3" /> Telegram Notify
                      </span>
                    )}
                    {wf.action_trash_email && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 border border-red-500/20">
                        <Trash2 className="h-3 w-3" /> Auto Trash
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-5 flex items-center justify-end gap-2 border-t border-surface-border/50 pt-3">
                  <button
                    onClick={() => openEditModal(wf)}
                    className="rounded px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-surface-border hover:text-white transition"
                  >
                    Edit Rule
                  </button>
                  <button
                    onClick={() => handleDelete(wf.id)}
                    className="rounded px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 transition flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Execution Logs */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <Clock className="h-4 w-4 text-accent" />
          Recent Execution Logs ({logs.length})
        </h3>

        {logs.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No workflow executions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-border text-xs uppercase text-gray-400 bg-surface-overlay/50">
                <tr>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Rule Name</th>
                  <th className="py-2.5 px-3">Email Subject / Sender</th>
                  <th className="py-2.5 px-3">Actions Executed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/40">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-overlay/30">
                    <td className="py-2.5 px-3 whitespace-nowrap text-xs text-gray-400">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-medium text-accent">
                      {log.workflow_name || 'Workflow Rule'}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-200">
                      <div className="font-semibold text-white">{log.subject || '(No Subject)'}</div>
                      <div className="text-gray-400">{log.from_address}</div>
                    </td>
                    <td className="py-2.5 px-3 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {log.actions_taken?.map((act, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-xs text-accent-hover border border-accent/20"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            {act}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-surface-border bg-surface-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-surface-border pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Zap className="h-5 w-5 text-accent" />
                {editingWf ? 'Edit Automation Rule' : 'Create New Automation Rule'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Rule Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Auto-Task for Customer Inquiries"
                  className="w-full rounded-lg border border-surface-border bg-black/40 px-3.5 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief summary of what this automation rule does"
                  className="w-full rounded-lg border border-surface-border bg-black/40 px-3.5 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
                />
              </div>

              {/* Trigger Criteria */}
              <div className="rounded-lg border border-surface-border bg-black/20 p-4 space-y-3">
                <h4 className="text-xs font-bold text-accent uppercase tracking-wider">Trigger Conditions</h4>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Email Category</label>
                    <select
                      value={triggerCategory}
                      onChange={(e) => setTriggerCategory(e.target.value)}
                      className="w-full rounded-lg border border-surface-border bg-black/40 px-3 py-2 text-white focus:border-accent focus:outline-none"
                    >
                      <option value="any">Any Category</option>
                      <option value="important">Important</option>
                      <option value="advertisement">Advertisement</option>
                      <option value="junk">Junk</option>
                      <option value="information">Information</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1">Sender Address / Domain</label>
                    <input
                      type="text"
                      value={triggerSender}
                      onChange={(e) => setTriggerSender(e.target.value)}
                      placeholder="e.g. client@acme.com or @acme.com"
                      className="w-full rounded-lg border border-surface-border bg-black/40 px-3 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Subject / Body Keyword</label>
                  <input
                    type="text"
                    value={triggerKeyword}
                    onChange={(e) => setTriggerKeyword(e.target.value)}
                    placeholder="e.g. invoice, urgent, quote request"
                    className="w-full rounded-lg border border-surface-border bg-black/40 px-3 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {/* Action Selections */}
              <div className="rounded-lg border border-surface-border bg-black/20 p-4 space-y-3">
                <h4 className="text-xs font-bold text-accent uppercase tracking-wider">Actions to Execute</h4>

                {/* Action 1: Create Task */}
                <div className="space-y-2 border-b border-surface-border/50 pb-3">
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={actionCreateTask}
                      onChange={(e) => setActionCreateTask(e.target.checked)}
                      className="rounded border-surface-border bg-black/40 text-accent focus:ring-accent"
                    />
                    Create Kanban Task
                  </label>
                  {actionCreateTask && (
                    <div className="pl-6 space-y-2 pt-1">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Target Kanban Project</label>
                        <select
                          value={taskProjectId}
                          onChange={(e) => setTaskProjectId(e.target.value)}
                          className="w-full rounded-lg border border-surface-border bg-black/40 px-3 py-1.5 text-white focus:border-accent focus:outline-none"
                        >
                          <option value="">Default Project</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Task Title Template</label>
                        <input
                          type="text"
                          value={taskTitleTemplate}
                          onChange={(e) => setTaskTitleTemplate(e.target.value)}
                          placeholder="e.g. Email: {{subject}}"
                          className="w-full rounded-lg border border-surface-border bg-black/40 px-3 py-1.5 text-white focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Action 2: Auto Reply */}
                <div className="space-y-2 border-b border-surface-border/50 pb-3">
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={actionAutoReply}
                      onChange={(e) => setActionAutoReply(e.target.checked)}
                      className="rounded border-surface-border bg-black/40 text-accent focus:ring-accent"
                    />
                    Send Auto Reply
                  </label>
                  {actionAutoReply && (
                    <div className="pl-6 space-y-2 pt-1">
                      <label className="block text-xs text-gray-400 mb-1">Reply Message Template</label>
                      <textarea
                        rows={3}
                        value={replyTemplate}
                        onChange={(e) => setReplyTemplate(e.target.value)}
                        placeholder="Thank you for reaching out. We have received your email and will respond shortly."
                        className="w-full rounded-lg border border-surface-border bg-black/40 px-3 py-1.5 text-white focus:border-accent focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* Action 3: Telegram Notification */}
                <div className="border-b border-surface-border/50 pb-3">
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={actionNotifyTelegram}
                      onChange={(e) => setActionNotifyTelegram(e.target.checked)}
                      className="rounded border-surface-border bg-black/40 text-accent focus:ring-accent"
                    />
                    Send Telegram Notification Alert
                  </label>
                </div>

                {/* Action 4: Trash Email */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-red-400">
                    <input
                      type="checkbox"
                      checked={actionTrashEmail}
                      onChange={(e) => setActionTrashEmail(e.target.checked)}
                      className="rounded border-surface-border bg-black/40 text-red-500 focus:ring-red-500"
                    />
                    Trash Email Message Automatically
                  </label>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-surface-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-surface-border px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-surface-border hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingWf ? 'Update Rule' : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
