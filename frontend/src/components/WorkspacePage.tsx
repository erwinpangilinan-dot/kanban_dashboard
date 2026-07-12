import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  CalendarPlus,
  ExternalLink,
  Mail,
  Reply,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  CalendarEvent,
  CreateCalendarEventInput,
  EmailMessage,
  EmailSummary,
  WorkspaceTab,
} from '../types';

interface WorkspacePageProps {
  refreshToken: number;
}

function formatWhen(value: string, allDay?: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (allDay) return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SetupNotice() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-100">
      <p className="font-medium">Google Workspace not configured</p>
      <p className="mt-2 text-amber-100/80">
        Set <code className="rounded bg-black/20 px-1">GOOGLE_CLIENT_ID</code>,{' '}
        <code className="rounded bg-black/20 px-1">GOOGLE_CLIENT_SECRET</code>, and{' '}
        <code className="rounded bg-black/20 px-1">GOOGLE_REFRESH_TOKEN</code> in{' '}
        <code className="rounded bg-black/20 px-1">.env</code>, then restart the API.
      </p>
      <p className="mt-2 text-amber-100/70">
        Authenticate via the Google Workspace MCP, then run{' '}
        <code className="rounded bg-black/20 px-1">npm run sync:google-token --prefix backend</code>.
      </p>
    </div>
  );
}

function EmailPanel({ refreshToken }: { refreshToken: number }) {
  const [messages, setMessages] = useState<EmailSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailMessage | null>(null);
  const [query, setQuery] = useState('in:inbox');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEmailMessages(query);
      setMessages(data);
      if (data.length && !selectedId) setSelectedId(data[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages, refreshToken]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setReplyOpen(false);
    api
      .getEmailMessage(selectedId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load message'))
      .finally(() => setDetailLoading(false));
  }, [selectedId, refreshToken]);

  async function handleReply() {
    if (!detail || !replyBody.trim()) return;
    const to = detail.from.replace(/.*<([^>]+)>.*/, '$1').trim() || detail.from;
    setSending(true);
    setError(null);
    try {
      await api.sendEmail({
        to,
        subject: detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`,
        body: replyBody,
        thread_id: detail.thread_id,
        in_reply_to: detail.id,
      });
      setReplyBody('');
      setReplyOpen(false);
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteEmailMessage(detail.id);
      const remaining = messages.filter((m) => m.id !== detail.id);
      setMessages(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDetail(null);
      setReplyOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete message');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-surface-border bg-surface-raised shadow-card">
        <div className="border-b border-surface-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadMessages()}
              placeholder="Gmail search (in:inbox)"
              className="w-full rounded-lg border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-gray-200 placeholder:text-gray-600 focus:border-accent/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-gray-500">Loading inbox…</p>
          ) : messages.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No messages found.</p>
          ) : (
            messages.map((msg) => (
              <button
                key={msg.id}
                type="button"
                onClick={() => setSelectedId(msg.id)}
                className={`block w-full border-b border-surface-border px-4 py-3 text-left transition-colors hover:bg-surface-overlay ${
                  selectedId === msg.id ? 'bg-accent/10' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={`truncate text-sm ${msg.unread ? 'font-semibold text-white' : 'text-gray-300'}`}>
                    {msg.from.replace(/<.*>/, '').trim() || msg.from}
                  </p>
                  {msg.unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                </div>
                <p className="mt-0.5 truncate text-sm text-gray-200">{msg.subject}</p>
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">{msg.snippet}</p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface-raised p-5 shadow-card">
        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {detailLoading ? (
          <p className="text-sm text-gray-500">Loading message…</p>
        ) : !detail ? (
          <p className="text-sm text-gray-500">Select a message to read.</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{detail.subject}</h3>
                <p className="mt-1 text-sm text-gray-400">From: {detail.from}</p>
                <p className="text-xs text-gray-500">{detail.date}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReplyOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:border-accent/40 hover:text-accent-hover"
                >
                  <Reply className="h-3.5 w-3.5" />
                  Reply
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-surface-border p-2 text-gray-400 hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
                  aria-label="Delete message"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
              {detail.body || detail.snippet}
            </div>
            {replyOpen && (
              <div className="mt-4 border-t border-surface-border pt-4">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={5}
                  placeholder="Write your reply…"
                  className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200 focus:border-accent/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleReply}
                  disabled={sending || !replyBody.trim()}
                  className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function toDatetimeLocal(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CalendarPanel({ refreshToken }: { refreshToken: number }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateCalendarEventInput>({
    summary: '',
    description: '',
    location: '',
    start: '',
    end: '',
    all_day: false,
  });

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await api.getCalendarEvents(21));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents, refreshToken]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.summary || !form.start || !form.end) return;
    setSaving(true);
    setError(null);
    try {
      await api.createCalendarEvent(form);
      setShowForm(false);
      setForm({ summary: '', description: '', location: '', start: '', end: '', all_day: false });
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await api.deleteCalendarEvent(id);
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Upcoming 3 weeks</p>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          New event
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-surface-border bg-surface-raised p-5 shadow-card"
        >
          <h3 className="text-sm font-semibold text-white">Create event</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              required
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              placeholder="Title"
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200 sm:col-span-2"
            />
            <input
              type="datetime-local"
              required
              value={toDatetimeLocal(form.start)}
              onChange={(e) => setForm((f) => ({ ...f, start: new Date(e.target.value).toISOString() }))}
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200"
            />
            <input
              type="datetime-local"
              required
              value={toDatetimeLocal(form.end)}
              onChange={(e) => setForm((f) => ({ ...f, end: new Date(e.target.value).toISOString() }))}
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200"
            />
            <input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="Location (optional)"
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200 sm:col-span-2"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)"
              rows={3}
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200 sm:col-span-2"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create event'}
          </button>
        </form>
      )}

      <div className="rounded-xl border border-surface-border bg-surface-raised shadow-card">
        {loading ? (
          <p className="p-5 text-sm text-gray-500">Loading calendar…</p>
        ) : events.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No upcoming events.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="font-medium text-white">{event.summary}</p>
                  <p className="mt-1 text-sm text-accent-hover">
                    {formatWhen(event.start, event.all_day)}
                    {event.end ? ` → ${formatWhen(event.end, event.all_day)}` : ''}
                  </p>
                  {event.location && <p className="mt-1 text-xs text-gray-500">{event.location}</p>}
                  {event.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-gray-400">{event.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {event.html_link && (
                    <a
                      href={event.html_link}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-surface-border p-2 text-gray-400 hover:border-accent/40 hover:text-accent-hover"
                      aria-label="Open in Google Calendar"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(event.id)}
                    className="rounded-lg border border-surface-border p-2 text-gray-400 hover:border-red-500/40 hover:text-red-300"
                    aria-label="Delete event"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function WorkspacePage({ refreshToken }: WorkspacePageProps) {
  const [tab, setTab] = useState<WorkspaceTab>('email');
  const [status, setStatus] = useState<{ enabled: boolean; account: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getWorkspaceStatus()
      .then((data) => setStatus({ enabled: data.enabled, account: data.account }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load workspace status';
        if (message.includes('not configured')) {
          setStatus({ enabled: false, account: null });
        } else {
          setError(message);
        }
      })
      .finally(() => setLoading(false));
  }, [refreshToken]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!status?.enabled) {
    return <SetupNotice />;
  }

  return (
    <div className="space-y-4">
      {status.account && (
        <p className="text-sm text-gray-500">
          Connected as <span className="text-gray-300">{status.account}</span>
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('email')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'email'
              ? 'bg-accent/15 text-accent-hover'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <Mail className="h-4 w-4" />
          Email
        </button>
        <button
          type="button"
          onClick={() => setTab('calendar')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'calendar'
              ? 'bg-accent/15 text-accent-hover'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <Calendar className="h-4 w-4" />
          Calendar
        </button>
      </div>

      {tab === 'email' ? (
        <EmailPanel refreshToken={refreshToken} />
      ) : (
        <CalendarPanel refreshToken={refreshToken} />
      )}
    </div>
  );
}
