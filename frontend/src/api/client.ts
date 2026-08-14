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
  WorkspaceSettings,
  EmailWorkflow,
  CreateEmailWorkflowInput,
  EmailWorkflowLog,
  MemoriaGraphData,
  NetworkDevicesResponse,
  NetworkConnectionDetailsResult,
  NetworkSetupClusterResult,
  NetworkSettingsResponse,
  NetworkAtlasSettings,
  SamsungPrecheckResult,
  SamsungAtlasCancelResult,
  SamsungPrecheckStatusResult,
  NetworkClusterPodsResponse,
  NetworkClusterPodsResult,
  NetworkSamsungIssue,
  NetworkSamsungIssuesResponse,
  NetworkVendorSettings,
  NetworkWrSubcloudSettings,
  NetworkWrSubcloudControllerSettings,
  SubcloudPrecheckResult,
  CurrentUser,
  DashboardUser,
  CreateUserInput,
  UpdateUserInput,
  SamsungAtlasOperation,
} from '../types';


const BASE = '/api';

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  onUnauthorized = handler;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (isFormData) delete headers['Content-Type'];

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
    const err = new Error(body.error || `Request failed: ${res.status}`) as Error & {
      code?: string;
      reauth_url?: string;
      status?: number;
    };
    err.code = body.code;
    err.reauth_url = body.reauth_url;
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AuthStatus {
  enabled: boolean;
}

export interface LoginResult extends Partial<CurrentUser> {
  enabled: boolean;
  token?: string;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/auth/status'),

  getMe: () => request<CurrentUser>('/auth/me'),

  login: (username: string, password: string) =>
    request<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getUsers: () => request<DashboardUser[]>('/users'),

  createUser: (data: CreateUserInput) =>
    request<DashboardUser>('/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (id: string, data: UpdateUserInput) =>
    request<DashboardUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),

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

  getWorkspaceSettings: () =>
    request<WorkspaceSettings>('/workspace/settings'),

  getEmailWorkflows: () =>
    request<EmailWorkflow[]>('/workspace/email/workflows'),

  createEmailWorkflow: (data: CreateEmailWorkflowInput) =>
    request<EmailWorkflow>('/workspace/email/workflows', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateEmailWorkflow: (id: string, data: Partial<CreateEmailWorkflowInput>) =>
    request<EmailWorkflow>(`/workspace/email/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteEmailWorkflow: (id: string) =>
    request<{ success: boolean }>(`/workspace/email/workflows/${id}`, { method: 'DELETE' }),

  getEmailWorkflowLogs: (limit = 50) =>
    request<EmailWorkflowLog[]>(`/workspace/email/workflows/logs?limit=${limit}`),

  getMemoriaGraph: (params?: { category?: string; type?: string; query?: string; start_date?: string; end_date?: string; min_weight?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.category) search.set('category', params.category);
    if (params?.type) search.set('type', params.type);
    if (params?.query) search.set('query', params.query);
    if (params?.start_date) search.set('start_date', params.start_date);
    if (params?.end_date) search.set('end_date', params.end_date);
    if (params?.min_weight) search.set('min_weight', String(params.min_weight));
    if (params?.limit) search.set('limit', String(params.limit));
    const queryStr = search.toString() ? `?${search.toString()}` : '';
    return request<MemoriaGraphData>(`/memoria/graph${queryStr}`);
  },

  ingestMemoriaProcedure: (data: {
    markdown: string;
    mop_id?: string;
    title?: string;
    task_triggers?: string[];
    entities?: string[];
  }) =>
    request<{
      mop_id: string;
      title: string;
      chunk_count: number;
      recall_hits: number;
      ingested: { section: number; section_title: string; id: string | null }[];
      skill_draft: { skillName: string; markdown: string };
    }>('/memoria/procedures', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  recallMemoria: (q: string, limit = 8) =>
    request<{ query: string; results: unknown[] }>(
      `/memoria/recall?q=${encodeURIComponent(q)}&limit=${limit}`
    ),

  extractMemoriaProcedureFile: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<{
      format: string;
      filename: string;
      markdown: string;
      suggested_mop_id: string;
      suggested_title: string;
      char_count: number;
    }>('/memoria/procedures/extract', { method: 'POST', body });
  },



  updateWorkspaceSettings: (settings: WorkspaceSettings) =>
    request<{ success: boolean }>('/workspace/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  getWorkspaceOauthStatus: () =>
    request<{
      client_credentials: boolean;
      configured: boolean;
      token_valid: boolean;
      needs_reauth: boolean;
      account: string | null;
      error: string | null;
    }>('/workspace/oauth/status'),

  startGoogleOAuth: () =>
    request<{ url: string }>('/workspace/oauth/start', { method: 'POST' }),

  getNetworkDevices: () => request<NetworkDevicesResponse>('/network/devices'),

  syncNetworkDevices: () =>
    request<{
      synced: number;
      probed?: number;
      middleware?: {
        enabled: boolean;
        sites?: number;
        matched?: number;
        updated?: number;
        errors?: { fuze_site_id: string; error: string }[];
      };
      sheet_writeback?: {
        enabled: boolean;
        cells?: number;
        rows?: number;
        batches?: number;
        error?: string;
        skipped?: boolean;
      };
      application_sw?: {
        tags?: string[];
        sheet?: string | null;
        error?: string;
        fetched_at?: string;
      };
    }>('/network/sync', { method: 'POST' }),

  rebootNetworkDevice: (
    id: string,
    data: { confirm_cluster_id: string; reset_type?: 'GracefulRestart' | 'ForceRestart' | 'PowerCycle' }
  ) =>
    request<{
      id: string;
      cluster_id: string;
      bmc_ip: string;
      reset_type: string;
      via?: string;
      ok: boolean;
    }>(`/network/devices/${id}/reboot`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resetBmcNetworkDevice: (
    id: string,
    data: { confirm_cluster_id: string; reset_type?: 'GracefulRestart' | 'ForceRestart' }
  ) =>
    request<{
      id: string;
      cluster_id: string;
      bmc_ip: string;
      target: string;
      reset_type: string;
      method?: string;
      manager?: string | null;
      ipmitool_mode?: string | null;
      via?: string;
      ok: boolean;
    }>(`/network/devices/${id}/bmc-reset`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  precheckNetworkDevice: (id: string) =>
    request<SubcloudPrecheckResult>(`/network/devices/${id}/precheck`, { method: 'POST' }),

  getNetworkClusterPods: () => request<NetworkClusterPodsResponse>('/network/pods'),

  listSamsungIssues: (params?: {
    cluster_id?: string;
    operation?: SamsungAtlasOperation | '';
    open_only?: boolean;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.cluster_id) q.set('cluster_id', params.cluster_id);
    if (params?.operation) q.set('operation', params.operation);
    if (params?.open_only) q.set('open_only', '1');
    if (params?.q) q.set('q', params.q);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<NetworkSamsungIssuesResponse>(
      `/network/samsung-issues${qs ? `?${qs}` : ''}`
    );
  },

  updateSamsungIssue: (
    id: string,
    data: { resolved_date?: string | null; resolution_details?: string | null }
  ) =>
    request<NetworkSamsungIssue>(`/network/samsung-issues/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getNetworkDevicePods: (id: string) =>
    request<NetworkClusterPodsResult>(`/network/devices/${id}/pods`),

  getNetworkConnectionDetails: (id: string) =>
    request<NetworkConnectionDetailsResult>(`/network/devices/${id}/connection-details`),

  postNetworkSetupCluster: (id: string) =>
    request<NetworkSetupClusterResult>(`/network/devices/${id}/setup-cluster`, {
      method: 'POST',
    }),

  runSamsungPrecheck: (
    id: string,
    data: { version: string; confirm_cluster_id?: string; workload?: 'UDU' | 'VDU' }
  ) =>
    request<SamsungPrecheckResult>(`/network/devices/${id}/samsung-precheck`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  runSamsungUpgrade: (
    id: string,
    data: { version: string; confirm_cluster_id?: string; workload?: 'UDU' | 'VDU' }
  ) =>
    request<SamsungPrecheckResult>(`/network/devices/${id}/samsung-upgrade`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  runSamsungRollback: (
    id: string,
    data: { version?: string; confirm_cluster_id?: string; workload?: 'UDU' | 'VDU' }
  ) =>
    request<SamsungPrecheckResult>(`/network/devices/${id}/samsung-rollback`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  runSamsungUndeployment: (
    id: string,
    data: { version?: string; confirm_cluster_id?: string; workload?: 'UDU' | 'VDU' }
  ) =>
    request<SamsungPrecheckResult>(`/network/devices/${id}/samsung-undeployment`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  runSamsungDeployment: (
    id: string,
    data: {
      version?: string;
      confirm_cluster_id?: string;
      workload?: 'UDU' | 'VDU';
      ciq_source?: string;
    }
  ) =>
    request<SamsungPrecheckResult>(`/network/devices/${id}/samsung-deployment`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancelSamsungUpgrade: (id: string, data?: { reason?: string; note?: string }) =>
    request<SamsungAtlasCancelResult>(`/network/devices/${id}/samsung-upgrade/cancel`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  cancelSamsungRollback: (id: string, data?: { reason?: string; note?: string }) =>
    request<SamsungAtlasCancelResult>(`/network/devices/${id}/samsung-rollback/cancel`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  cancelSamsungUndeployment: (id: string, data?: { reason?: string; note?: string }) =>
    request<SamsungAtlasCancelResult>(`/network/devices/${id}/samsung-undeployment/cancel`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  cancelSamsungDeployment: (id: string, data?: { reason?: string; note?: string }) =>
    request<SamsungAtlasCancelResult>(`/network/devices/${id}/samsung-deployment/cancel`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  getSamsungPrecheckStatus: (
    id: string,
    opts?: {
      jobId?: number | null;
      jobKind?: 'job' | 'workflow_job' | null;
      launchedAfter?: string | null;
      launcherJobId?: number | null;
      monitorJobId?: number | null;
      monitorJobKind?: 'job' | 'workflow_job' | null;
      workload?: 'UDU' | 'VDU' | null;
    }
  ) => {
    const params = new URLSearchParams();
    if (opts?.jobId) params.set('job_id', String(opts.jobId));
    if (opts?.jobKind) params.set('job_kind', opts.jobKind);
    if (opts?.launchedAfter) params.set('launched_after', opts.launchedAfter);
    if (opts?.launcherJobId) params.set('launcher_job_id', String(opts.launcherJobId));
    if (opts?.monitorJobId) params.set('monitor_job_id', String(opts.monitorJobId));
    if (opts?.monitorJobKind) params.set('monitor_job_kind', opts.monitorJobKind);
    if (opts?.workload) params.set('workload', opts.workload);
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<SamsungPrecheckStatusResult>(`/network/devices/${id}/samsung-precheck/status${q}`);
  },

  getSamsungUpgradeStatus: (
    id: string,
    opts?: {
      jobId?: number | null;
      jobKind?: 'job' | 'workflow_job' | null;
      launchedAfter?: string | null;
      launcherJobId?: number | null;
      monitorJobId?: number | null;
      monitorJobKind?: 'job' | 'workflow_job' | null;
      workload?: 'UDU' | 'VDU' | null;
    }
  ) => {
    const params = new URLSearchParams();
    if (opts?.jobId) params.set('job_id', String(opts.jobId));
    if (opts?.jobKind) params.set('job_kind', opts.jobKind);
    if (opts?.launchedAfter) params.set('launched_after', opts.launchedAfter);
    if (opts?.launcherJobId) params.set('launcher_job_id', String(opts.launcherJobId));
    if (opts?.monitorJobId) params.set('monitor_job_id', String(opts.monitorJobId));
    if (opts?.monitorJobKind) params.set('monitor_job_kind', opts.monitorJobKind);
    if (opts?.workload) params.set('workload', opts.workload);
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<SamsungPrecheckStatusResult>(`/network/devices/${id}/samsung-upgrade/status${q}`);
  },

  getSamsungRollbackStatus: (
    id: string,
    opts?: {
      jobId?: number | null;
      jobKind?: 'job' | 'workflow_job' | null;
      launchedAfter?: string | null;
      launcherJobId?: number | null;
      monitorJobId?: number | null;
      monitorJobKind?: 'job' | 'workflow_job' | null;
      workload?: 'UDU' | 'VDU' | null;
    }
  ) => {
    const params = new URLSearchParams();
    if (opts?.jobId) params.set('job_id', String(opts.jobId));
    if (opts?.jobKind) params.set('job_kind', opts.jobKind);
    if (opts?.launchedAfter) params.set('launched_after', opts.launchedAfter);
    if (opts?.launcherJobId) params.set('launcher_job_id', String(opts.launcherJobId));
    if (opts?.monitorJobId) params.set('monitor_job_id', String(opts.monitorJobId));
    if (opts?.monitorJobKind) params.set('monitor_job_kind', opts.monitorJobKind);
    if (opts?.workload) params.set('workload', opts.workload);
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<SamsungPrecheckStatusResult>(`/network/devices/${id}/samsung-rollback/status${q}`);
  },

  getSamsungUndeploymentStatus: (
    id: string,
    opts?: {
      jobId?: number | null;
      jobKind?: 'job' | 'workflow_job' | null;
      launchedAfter?: string | null;
      launcherJobId?: number | null;
      monitorJobId?: number | null;
      monitorJobKind?: 'job' | 'workflow_job' | null;
      workload?: 'UDU' | 'VDU' | null;
    }
  ) => {
    const params = new URLSearchParams();
    if (opts?.jobId) params.set('job_id', String(opts.jobId));
    if (opts?.jobKind) params.set('job_kind', opts.jobKind);
    if (opts?.launchedAfter) params.set('launched_after', opts.launchedAfter);
    if (opts?.launcherJobId) params.set('launcher_job_id', String(opts.launcherJobId));
    if (opts?.monitorJobId) params.set('monitor_job_id', String(opts.monitorJobId));
    if (opts?.monitorJobKind) params.set('monitor_job_kind', opts.monitorJobKind);
    if (opts?.workload) params.set('workload', opts.workload);
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<SamsungPrecheckStatusResult>(
      `/network/devices/${id}/samsung-undeployment/status${q}`
    );
  },

  getSamsungDeploymentStatus: (
    id: string,
    opts?: {
      jobId?: number | null;
      jobKind?: 'job' | 'workflow_job' | null;
      launchedAfter?: string | null;
      launcherJobId?: number | null;
      monitorJobId?: number | null;
      monitorJobKind?: 'job' | 'workflow_job' | null;
      workload?: 'UDU' | 'VDU' | null;
    }
  ) => {
    const params = new URLSearchParams();
    if (opts?.jobId) params.set('job_id', String(opts.jobId));
    if (opts?.jobKind) params.set('job_kind', opts.jobKind);
    if (opts?.launchedAfter) params.set('launched_after', opts.launchedAfter);
    if (opts?.launcherJobId) params.set('launcher_job_id', String(opts.launcherJobId));
    if (opts?.monitorJobId) params.set('monitor_job_id', String(opts.monitorJobId));
    if (opts?.monitorJobKind) params.set('monitor_job_kind', opts.monitorJobKind);
    if (opts?.workload) params.set('workload', opts.workload);
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<SamsungPrecheckStatusResult>(
      `/network/devices/${id}/samsung-deployment/status${q}`
    );
  },

  getNetworkSettings: () => request<NetworkSettingsResponse>('/network/settings'),

  updateNetworkSettings: (data: { vendor: string; username?: string; password?: string }) =>
    request<NetworkVendorSettings & { configured?: boolean }>('/network/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateWrSubcloudSettings: (data: { username?: string; password?: string }) =>
    request<NetworkWrSubcloudSettings & { scope?: string }>('/network/settings', {
      method: 'POST',
      body: JSON.stringify({ scope: 'wr_subcloud', ...data }),
    }),

  updateWrSubcloudControllerSettings: (data: {
    controller: string;
    username?: string;
    password?: string;
  }) =>
    request<
      NetworkWrSubcloudControllerSettings & {
        scope?: string;
        wr_subcloud_controllers?: NetworkWrSubcloudControllerSettings[];
      }
    >('/network/settings', {
      method: 'POST',
      body: JSON.stringify({ scope: 'wr_subcloud_controller', ...data }),
    }),

  updatePrecheckCustomCommands: (commands: string) =>
    request<{ scope: string; count: number; precheck_custom_commands: string }>(
      '/network/settings',
      {
        method: 'POST',
        body: JSON.stringify({ scope: 'precheck_custom', commands }),
      }
    ),

  updateAtlasBearerToken: (bearerToken: string) =>
    request<{
      scope: string;
      bearer_token_set: boolean;
      configured: boolean;
      atlas?: NetworkAtlasSettings;
    }>('/network/settings', {
      method: 'POST',
      body: JSON.stringify({ scope: 'atlas_bearer', bearer_token: bearerToken }),
    }),

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
