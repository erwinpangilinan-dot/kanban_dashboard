import { clearToken, getToken, setToken } from '../lib/auth';
import type {
  BoardData,
  CalendarEvent,
  CreateCalendarEventInput,
  CreateTaskInput,
  EmailMessage,
  EmailSummary,
  EmailAssistantReview,
  EmailAssistantScanResult,
  EmailAssistantCleanupResult,
  GitHubStatus,
  Label,
  OverviewData,
  Project,
  SendEmailInput,
  Task,
  UpdateTaskInput,
  WorkspaceStatus,
  EmailAgentReview,
} from '../types';

const BASE = '/api';

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  onUnauthorized = handler;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    onUnauthorized?.();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Authentication required');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AuthStatus {
  enabled: boolean;
}

export interface LoginResult {
  enabled: boolean;
  token?: string;
  username?: string;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/auth/status'),

  getMe: () => request<{ username: string }>('/auth/me'),

  login: (username: string, password: string) =>
    request<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getProjects: () => request<Project[]>('/projects'),

  createProject: (data: { name: string; description?: string; color?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  getBoard: (projectId: string) => request<BoardData>(`/projects/${projectId}/board`),

  createTask: (columnId: string, data: CreateTaskInput) =>
    request<Task>(`/columns/${columnId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTask: (taskId: string, data: UpdateTaskInput) =>
    request<Task>(`/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTask: (taskId: string) =>
    request<void>(`/tasks/${taskId}`, { method: 'DELETE' }),

  moveTask: (taskId: string, columnId: string, position: number) =>
    request<Task>(`/tasks/${taskId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ column_id: columnId, position }),
    }),

  getOverview: () => request<OverviewData>('/overview'),

  getWorkspaceStatus: () => request<WorkspaceStatus>('/workspace/status'),

  getEmailMessages: (q = 'in:inbox', max = 25) =>
    request<EmailSummary[]>(`/workspace/email/messages?q=${encodeURIComponent(q)}&max=${max}`),

  getEmailMessage: (id: string) => request<EmailMessage>(`/workspace/email/messages/${id}`),

  sendEmail: (data: SendEmailInput) =>
    request<EmailMessage>('/workspace/email/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteEmailMessage: (id: string) =>
    request<void>(`/workspace/email/messages/${id}`, { method: 'DELETE' }),

  reviewEmail: (id: string) =>
    request<EmailAssistantReview>(`/workspace/email/assistant/review/${id}`, { method: 'POST' }),

  scanEmailInbox: (q = 'in:inbox', max = 5) =>
    request<EmailAssistantScanResult>('/workspace/email/assistant/scan', {
      method: 'POST',
      body: JSON.stringify({ q, max }),
    }),

  cleanupEmailInbox: (q = 'in:inbox', max = 25) =>
    request<EmailAssistantCleanupResult>('/workspace/email/assistant/cleanup', {
      method: 'POST',
      body: JSON.stringify({ q, max }),
    }),

  getCalendarEvents: (days = 14) =>
    request<CalendarEvent[]>(`/workspace/calendar/events?days=${days}`),

  createCalendarEvent: (data: CreateCalendarEventInput) =>
    request<CalendarEvent>('/workspace/calendar/events', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteCalendarEvent: (id: string) =>
    request<void>(`/workspace/calendar/events/${id}`, { method: 'DELETE' }),

  getEmailAgentReviews: (limit = 50) =>
    request<EmailAgentReview[]>(`/workspace/email/agent/reviews?limit=${limit}`),

  getEmailAgentPending: () =>
    request<EmailAgentReview[]>('/workspace/email/agent/pending'),

  approveEmailAgentDraft: (id: string, body: string) =>
    request<{ success: boolean }>(`/workspace/email/agent/approve/${id}`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  rejectEmailAgentDraft: (id: string) =>
    request<{ success: boolean }>(`/workspace/email/agent/reject/${id}`, { method: 'POST' }),

  triggerEmailAgentScan: () =>
    request<{ success: boolean }>('/workspace/email/agent/trigger', { method: 'POST' }),

  getGitHubStatus: () => request<GitHubStatus>('/github/status'),

  createGitHubIssue: (taskId: string) =>
    request<Task>(`/tasks/${taskId}/github-issue`, { method: 'POST' }),

  createLabel: (projectId: string, data: { name: string; color?: string }) =>
    request<Label>(`/projects/${projectId}/labels`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteLabel: (labelId: string) =>
    request<void>(`/labels/${labelId}`, { method: 'DELETE' }),

  async exportBoard(projectId: string, format: 'csv' | 'json' = 'csv') {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}/projects/${projectId}/export?format=${format}`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Export failed: ${res.status}`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `export.${format}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export { setToken };
