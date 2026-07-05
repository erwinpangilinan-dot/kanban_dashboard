import { clearToken, getToken, setToken } from '../lib/auth';
import type {
  BoardData,
  CreateTaskInput,
  GitHubStatus,
  OverviewData,
  Project,
  Task,
  UpdateTaskInput,
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

  getGitHubStatus: () => request<GitHubStatus>('/github/status'),

  createGitHubIssue: (taskId: string) =>
    request<Task>(`/tasks/${taskId}/github-issue`, { method: 'POST' }),
};

export { setToken };
