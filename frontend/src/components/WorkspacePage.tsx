import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Calendar,
  CalendarPlus,
  ExternalLink,
  Mail,
  Reply,
  Search,
  Sparkles,
  Trash2,
  Settings,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  CalendarEvent,
  CreateCalendarEventInput,
  EmailAssistantCategory,
  EmailAssistantReview,
  EmailAssistantCleanupResult,
  EmailMessage,
  EmailSummary,
  WorkspaceTab,
  EmailAgentReview,
  WorkspaceSettings,
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

function categoryLabel(category: EmailAssistantCategory) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function categoryClass(category: EmailAssistantCategory) {
  switch (category) {
    case 'important':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
    case 'advertisement':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-200';
    case 'newsletter':
      return 'border-purple-500/30 bg-purple-500/10 text-purple-200';
    case 'notification':
      return 'border-gray-500/30 bg-gray-500/10 text-gray-300';
    default:
      return 'border-surface-border bg-surface-overlay text-gray-300';
  }
}

interface AssistantReviewCardProps {
  review: EmailAssistantReview;
  onApproveDelete: () => void;
  onApproveReply: (subject: string, body: string) => void;
  onDismiss: () => void;
  sending: boolean;
  deleting: boolean;
}

function AssistantReviewCard({
  review,
  onApproveDelete,
  onApproveReply,
  onDismiss,
  sending,
  deleting,
}: AssistantReviewCardProps) {
  const [draftSubject, setDraftSubject] = useState(review.draft_reply?.subject || '');
  const [draftBody, setDraftBody] = useState(review.draft_reply?.body || '');

  useEffect(() => {
    setDraftSubject(review.draft_reply?.subject || '');
    setDraftBody(review.draft_reply?.body || '');
  }, [review]);

  if (review.error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        Assistant could not review this message: {review.error}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-accent-hover" />
        <span className="text-sm font-semibold text-white">Assistant review</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${categoryClass(review.category)}`}>
          {categoryLabel(review.category)}
        </span>
      </div>
      {review.summary && <p className="mt-2 text-sm text-gray-300">{review.summary}</p>}
      {review.reasoning && <p className="mt-1 text-xs text-gray-500">{review.reasoning}</p>}

      {review.should_delete && (
        <div className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
          <p className="text-sm text-orange-100">
            {review.category === 'notification'
              ? 'This looks like an automated system notification. Delete it?'
              : review.category === 'newsletter'
                ? 'This looks like a newsletter. Delete it?'
                : 'This looks like an advertisement. Delete it?'}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onApproveDelete}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Approve delete'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-gray-300 hover:text-white"
            >
              Keep email
            </button>
          </div>
        </div>
      )}

      {review.needs_reply && review.draft_reply && (
        <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
          <p className="text-sm text-blue-100">This needs your reply. Review the draft below:</p>
          <input
            value={draftSubject}
            onChange={(e) => setDraftSubject(e.target.value)}
            className="mt-2 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={5}
            className="mt-2 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onApproveReply(draftSubject, draftBody)}
              disabled={sending || !draftBody.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Approve & send'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-gray-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!review.should_delete && !review.needs_reply && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 text-xs text-gray-500 hover:text-gray-300"
        >
          Dismiss
        </button>
      )}
    </div>
  );
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

function EmailPanel({
  refreshToken,
  assistantEnabled,
}: {
  refreshToken: number;
  assistantEnabled: 'ollama' | 'gemini' | boolean;
}) {
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
  const [assistantReview, setAssistantReview] = useState<EmailAssistantReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanQueue, setScanQueue] = useState<EmailAssistantReview[]>([]);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<EmailAssistantCleanupResult | null>(null);

  // Email Agent states
  const [viewMode, setViewMode] = useState<'inbox' | 'agent'>('inbox');
  const [agentReviews, setAgentReviews] = useState<EmailAgentReview[]>([]);
  const [selectedAgentReviewId, setSelectedAgentReviewId] = useState<string | null>(null);
  const [editedDraftBody, setEditedDraftBody] = useState('');
  const [triggeringScan, setTriggeringScan] = useState(false);

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
  }, [query, selectedId]);

  const loadAgentReviews = useCallback(async () => {
    try {
      const data = await api.getEmailAgentPending();
      setAgentReviews(data);
      if (data.length && !selectedAgentReviewId) {
        setSelectedAgentReviewId(data[0].id);
        setEditedDraftBody(data[0].proposed_body || '');
      }
    } catch (err) {
      console.error('Failed to load agent reviews:', err);
    }
  }, [selectedAgentReviewId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages, refreshToken]);

  useEffect(() => {
    loadAgentReviews();
  }, [loadAgentReviews, viewMode, refreshToken]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setReplyOpen(false);
    setAssistantReview((prev) => (prev?.message_id === selectedId ? prev : null));
    api
      .getEmailMessage(selectedId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load message'))
      .finally(() => setDetailLoading(false));
  }, [selectedId, refreshToken]);

  useEffect(() => {
    const active = agentReviews.find((r) => r.id === selectedAgentReviewId);
    if (active) {
      setEditedDraftBody(active.proposed_body || '');
    } else {
      setEditedDraftBody('');
    }
  }, [selectedAgentReviewId, agentReviews]);

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
      setAssistantReview(null);
      advanceScanQueue(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete message');
    } finally {
      setDeleting(false);
    }
  }

  function advanceScanQueue(completedId: string) {
    setScanQueue((prev) => {
      const next = prev.filter((r) => r.message_id !== completedId);
      const nextReview = next.find((r) => r.should_delete || r.needs_reply) || null;
      setAssistantReview(nextReview);
      if (nextReview) setSelectedId(nextReview.message_id);
      return next;
    });
  }

  async function handleReview() {
    if (!selectedId || !assistantEnabled) return;
    setReviewing(true);
    setError(null);
    setScanNotice(null);
    try {
      setAssistantReview(await api.reviewEmail(selectedId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant review failed');
    } finally {
      setReviewing(false);
    }
  }

  async function handleScanInbox() {
    if (!assistantEnabled) return;
    setScanning(true);
    setError(null);
    setScanNotice(null);
    try {
      const result = await api.scanEmailInbox(query, 5);
      const actionable = result.reviews.filter((r) => r.should_delete || r.needs_reply);
      setScanQueue(actionable);
      const first = actionable[0] || null;
      if (first) {
        setSelectedId(first.message_id);
        setAssistantReview(first);
        setScanNotice(
          actionable.length === 1
            ? '1 email needs your approval.'
            : `${actionable.length} emails need your approval — showing the first.`
        );
      } else {
        setAssistantReview(null);
        setScanNotice(`Scan complete — reviewed ${result.scanned} emails, none need action.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inbox scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function handleCleanup() {
    if (!assistantEnabled) return;
    setCleaning(true);
    setError(null);
    setCleanupResult(null);
    setScanNotice(null);
    setAssistantReview(null);
    setScanQueue([]);
    try {
      const result = await api.cleanupEmailInbox(query, 25);
      const deletedIds = new Set(result.deleted_messages.map((m) => m.message_id));
      const remaining = messages.filter((m) => !deletedIds.has(m.id));
      setMessages(remaining);
      if (selectedId && deletedIds.has(selectedId)) {
        setSelectedId(remaining[0]?.id ?? null);
        setDetail(null);
      }
      setCleanupResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inbox cleanup failed');
    } finally {
      setCleaning(false);
    }
  }

  // Email Agent actions
  async function handleApproveAgentDraft(id: string) {
    setSending(true);
    setError(null);
    try {
      await api.approveEmailAgentDraft(id, editedDraftBody);
      await loadAgentReviews();
      await loadMessages();
      setSelectedAgentReviewId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve draft');
    } finally {
      setSending(false);
    }
  }

  async function handleRejectAgentDraft(id: string) {
    setSending(true);
    setError(null);
    try {
      await api.rejectEmailAgentDraft(id);
      await loadAgentReviews();
      await loadMessages();
      setSelectedAgentReviewId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject draft');
    } finally {
      setSending(false);
    }
  }

  async function handleTriggerAgentScan() {
    setTriggeringScan(true);
    setError(null);
    try {
      await api.triggerEmailAgentScan();
      await loadAgentReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run agent scan');
    } finally {
      setTriggeringScan(false);
    }
  }

  const assistantBusy = scanning || reviewing || cleaning || triggeringScan;

  function handleOpenErrorEmail(messageId: string) {
    setSelectedId(messageId);
    setScanNotice('Opened failed email — click Review to retry classification.');
    setAssistantReview(null);
  }

  async function handleApproveReply(subject: string, body: string) {
    if (!detail) return;
    const to = detail.from.replace(/.*<([^>]+)>.*/, '$1').trim() || detail.from;
    setSending(true);
    setError(null);
    try {
      await api.sendEmail({
        to,
        subject: subject || (detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`),
        body,
        thread_id: detail.thread_id,
        in_reply_to: detail.id,
      });
      setReplyBody('');
      setReplyOpen(false);
      setAssistantReview(null);
      advanceScanQueue(detail.id);
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  const activeReview = assistantReview?.message_id === selectedId ? assistantReview : null;
  const activeAgentReview = agentReviews.find((r) => r.id === selectedAgentReviewId) || null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-surface-border bg-surface-raised shadow-card">
        {/* View Mode Tabs */}
        <div className="flex border-b border-surface-border text-center">
          <button
            type="button"
            onClick={() => setViewMode('inbox')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
              viewMode === 'inbox'
                ? 'border-accent text-accent-hover'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Inbox ({messages.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('agent')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 flex items-center justify-center gap-1.5 ${
              viewMode === 'agent'
                ? 'border-accent text-accent-hover'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            Agent Drafts ({agentReviews.length})
          </button>
        </div>

        <div className="border-b border-surface-border p-3 space-y-2">
          {viewMode === 'inbox' ? (
            <>
              {assistantEnabled && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleScanInbox}
                    disabled={assistantBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-xs font-medium text-accent-hover hover:bg-accent/25 disabled:opacity-50"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {scanning ? 'Scanning inbox…' : 'Scan inbox with assistant'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCleanup}
                    disabled={assistantBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs font-medium text-orange-200 hover:bg-orange-500/20 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {cleaning ? 'Cleaning inbox…' : 'Auto-cleanup junk'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={handleTriggerAgentScan}
              disabled={assistantBusy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Bot className="h-3.5 w-3.5" />
              {triggeringScan ? 'Agent scanning inbox…' : `Trigger agent scan now (${assistantEnabled === 'gemini' ? 'Gemini' : 'Ollama'})`}
            </button>
          )}

          {scanning && (
            <p className="text-xs text-gray-500">Reviewing up to 5 emails — may take 15–60 seconds.</p>
          )}
          {cleaning && (
            <p className="text-xs text-gray-500">Scanning up to 25 emails and trashing junk — may take 1–3 minutes.</p>
          )}
          {triggeringScan && (
            <p className="text-xs text-gray-500">Agent checking for new emails and generating replies with Memoria context — may take 15-45 seconds.</p>
          )}

          {cleanupResult && !cleaning && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">
              <p>
                Cleanup done — trashed {cleanupResult.deleted} junk email{cleanupResult.deleted === 1 ? '' : 's'},
                kept {cleanupResult.skipped} (reviewed {cleanupResult.scanned})
                {cleanupResult.errors.length > 0 && `, ${cleanupResult.errors.length} error${cleanupResult.errors.length === 1 ? '' : 's'}`}.
              </p>
              {cleanupResult.errors.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-t border-orange-500/20 pt-2">
                  {cleanupResult.errors.map((item) => (
                    <li key={item.message_id} className="text-orange-50/90">
                      <button
                        type="button"
                        onClick={() => handleOpenErrorEmail(item.message_id)}
                        className="font-medium text-accent-hover underline decoration-accent-hover/40 hover:text-white"
                        title="Open this email to review"
                      >
                        {item.subject || 'Unknown subject'}
                      </button>
                      <span className="text-orange-100/70"> — {item.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {scanNotice && !scanning && (
            <p className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent-hover">
              {scanNotice}
            </p>
          )}

          {viewMode === 'inbox' && (
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
          )}
        </div>

        <div className="max-h-[560px] overflow-y-auto">
          {viewMode === 'inbox' ? (
            loading ? (
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
            )
          ) : (
            agentReviews.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No pending drafts to review.</p>
            ) : (
              agentReviews.map((rev) => (
                <button
                  key={rev.id}
                  type="button"
                  onClick={() => setSelectedAgentReviewId(rev.id)}
                  className={`block w-full border-b border-surface-border px-4 py-3 text-left transition-colors hover:bg-surface-overlay ${
                    selectedAgentReviewId === rev.id ? 'bg-accent/10' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-accent-hover">
                      {rev.from_address.replace(/<.*>/, '').trim() || rev.from_address}
                    </p>
                    <span className="text-[10px] text-gray-500">
                      {new Date(rev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-gray-200">{rev.subject}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{rev.body_snippet}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="inline-block rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                      {rev.category}
                    </span>
                    <span className="text-[10px] text-accent/80 font-medium">Needs Reply</span>
                  </div>
                </button>
              ))
            )
          )}
        </div>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface-raised p-5 shadow-card">
        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {viewMode === 'inbox' ? (
          detailLoading ? (
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
                  {assistantEnabled && (
                    <button
                      type="button"
                      onClick={handleReview}
                      disabled={assistantBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent-hover hover:bg-accent/10 disabled:opacity-50"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      {reviewing ? 'Reviewing…' : 'Review'}
                    </button>
                  )}
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
              {activeReview && (
                <div className="mt-4">
                  <AssistantReviewCard
                    review={activeReview}
                    onApproveDelete={handleDelete}
                    onApproveReply={handleApproveReply}
                    onDismiss={() => {
                      setAssistantReview(null);
                      if (scanQueue.length) advanceScanQueue(activeReview.message_id);
                    }}
                    sending={sending}
                    deleting={deleting}
                  />
                </div>
              )}
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
          )
        ) : (
          !activeAgentReview ? (
            <p className="text-sm text-gray-500">Select a pending draft to review.</p>
          ) : (
            <>
              {/* Draft Review Details */}
              <div className="flex items-start justify-between gap-3 border-b border-surface-border pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Email Agent Proposed Draft</span>
                  </div>
                  <h3 className="mt-1.5 text-base font-semibold text-white">{activeAgentReview.subject}</h3>
                  <p className="mt-1 text-sm text-gray-400">From: {activeAgentReview.from_address}</p>
                  <p className="text-xs text-gray-500">Reviewed on {new Date(activeAgentReview.created_at).toLocaleString()}</p>
                </div>
              </div>

              {/* Original snippet */}
              <div className="mt-4 rounded-lg bg-surface-overlay p-4 border border-surface-border">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Original Email Snippet</h4>
                <p className="mt-2 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{activeAgentReview.body_snippet}</p>
              </div>

              {/* Proposed Reply Compose Area */}
              <div className="mt-5 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-accent uppercase tracking-wider block mb-1">Proposed Subject</label>
                  <input
                    type="text"
                    disabled
                    value={activeAgentReview.proposed_subject || `Re: ${activeAgentReview.subject}`}
                    className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-gray-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-accent uppercase tracking-wider block mb-1 flex items-center justify-between">
                    <span>Proposed Reply Body (Editable - {assistantEnabled === 'gemini' ? 'Gemini' : 'Ollama'} active)</span>
                    <span className="text-[10px] text-emerald-400 normal-case">Memoria profile facts loaded</span>
                  </label>
                  <textarea
                    rows={8}
                    value={editedDraftBody}
                    onChange={(e) => setEditedDraftBody(e.target.value)}
                    className="w-full rounded-lg border border-surface-border bg-surface px-3 py-3 text-sm text-gray-200 leading-relaxed focus:border-accent/50 focus:outline-none"
                  />
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => handleApproveAgentDraft(activeAgentReview.id)}
                    disabled={sending || !editedDraftBody.trim()}
                    className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5"
                  >
                    Approve & Send
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectAgentDraft(activeAgentReview.id)}
                    disabled={sending}
                    className="rounded-lg border border-surface-border hover:border-red-500/40 hover:text-red-300 px-4 py-2.5 text-sm font-semibold text-gray-300 disabled:opacity-50"
                  >
                    Reject Draft
                  </button>
                </div>
              </div>
            </>
          )
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

function SettingsPanel() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getWorkspaceSettings()
      .then((data) => {
        setSettings(data);
        setApiKeyInput(data.gemini_api_key || '');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.updateWorkspaceSettings({
        email_agent_llm_provider: settings.email_agent_llm_provider,
        gemini_api_key: apiKeyInput
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading settings…</div>;
  }

  if (!settings) {
    return <div className="text-sm text-red-400">Failed to load settings configuration.</div>;
  }

  return (
    <div className="max-w-md rounded-xl border border-surface-border bg-surface-raised p-6 shadow-card">
      <h3 className="text-lg font-semibold text-white mb-4">Workspace Settings</h3>
      {error && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Settings saved successfully!
        </p>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-accent uppercase tracking-wider mb-2">
            Email Agent LLM Provider
          </label>
          <select
            value={settings.email_agent_llm_provider}
            onChange={(e) => setSettings({
              ...settings,
              email_agent_llm_provider: e.target.value as 'ollama' | 'gemini'
            })}
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200 focus:border-accent/50 focus:outline-none"
          >
            <option value="ollama">Ollama (Local Qwen3.5)</option>
            <option value="gemini">Gemini API (Google Cloud)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-accent uppercase tracking-wider mb-2">
            Gemini API Key
          </label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={apiKeyInput === '********' ? '••••••••' : 'Enter your Gemini API Key'}
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-gray-200 focus:border-accent/50 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            If selected, the agent will call the Gemini REST API to process emails. Your key is securely saved in the database.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

export function WorkspacePage({ refreshToken }: WorkspacePageProps) {
  const [tab, setTab] = useState<WorkspaceTab>('email');
  const [status, setStatus] = useState<{
    enabled: boolean;
    assistant: 'ollama' | 'gemini' | boolean;
    account: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getWorkspaceStatus()
      .then((data) => setStatus({
        enabled: data.enabled,
        assistant: data.assistant,
        account: data.account,
      }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load workspace status';
        if (message.includes('not configured')) {
          setStatus({ enabled: false, assistant: false, account: null });
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
          {status.assistant && (
            <span className="ml-2 text-accent-hover">
              · Assistant active ({status.assistant === 'gemini' ? 'Gemini' : 'Ollama'})
            </span>
          )}
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
        <button
          type="button"
          onClick={() => setTab('settings')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'settings'
              ? 'bg-accent/15 text-accent-hover'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>

      {tab === 'email' ? (
        <EmailPanel refreshToken={refreshToken} assistantEnabled={status.assistant} />
      ) : tab === 'calendar' ? (
        <CalendarPanel refreshToken={refreshToken} />
      ) : (
        <SettingsPanel />
      )}
    </div>
  );
}
