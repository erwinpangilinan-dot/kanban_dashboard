export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Label {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
  board_count?: number;
}

export interface Board {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
}

export interface Task {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignee: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  github_repo?: string | null;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  labels?: Label[];
}

export interface GitHubStatus {
  enabled: boolean;
  default_repo: string | null;
  auto_create: boolean;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
  created_at: string;
  tasks: Task[];
}

export interface BoardData {
  project: Project;
  board: Board;
  labels?: Label[];
  columns: Column[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignee?: string;
  due_date?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assignee?: string | null;
  due_date?: string | null;
  github_issue_url?: string | null;
  label_ids?: string[];
}

export interface OverviewMetrics {
  total: number;
  backlog: number;
  in_progress: number;
  completed: number;
  overdue: number;
  due_this_week: number;
  completed_this_week: number;
}

export interface ProjectWidget {
  id: string;
  name: string;
  description: string | null;
  color: string;
  total: number;
  completed: number;
  active: number;
  overdue: number;
  in_progress: number;
  progress_percent: number;
}

export interface UpcomingTask {
  id: string;
  title: string;
  due_date: string;
  priority: TaskPriority;
  assignee: string | null;
  column_name: string;
  project_id: string;
  project_name: string;
  project_color: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  task_title: string | null;
  from_column: string | null;
  to_column: string | null;
  created_at: string;
  project_name: string | null;
  project_color: string | null;
}

export interface OverviewData {
  metrics: OverviewMetrics;
  projects: ProjectWidget[];
  upcoming: UpcomingTask[];
  activity: ActivityItem[];
}

export interface MemoriaNode {
  id: string;
  kind: 'entity' | 'memory';
  label: string;
  content?: string;
  type: string;
  importance?: 'low' | 'medium' | 'high';
  vault_path?: string;
  category: string;
  valency: number;
  needs_consolidation?: boolean;
  cluster_id?: number;
  created_at?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface MemoriaEdge {
  id: string;
  source: string | MemoriaNode;
  target: string | MemoriaNode;
  from: string;
  to: string;
  kind: 'link' | 'cooccurrence' | string;
  weight: number;
  label?: string;
}

export interface MemoriaGraphData {
  node_count: number;
  edge_count: number;
  cluster_count?: number;
  consolidation_warnings_count?: number;
  categories: string[];
  nodes: MemoriaNode[];
  edges: MemoriaEdge[];
  error?: string;
}


export type AppView = 'overview' | 'board' | 'workspace' | 'memoria' | 'network' | 'users';

/** Tabs an admin can grant. The `users` tab comes with the admin role instead. */
export const ASSIGNABLE_VIEWS = [
  'overview',
  'board',
  'workspace',
  'memoria',
  'network',
] as const satisfies readonly AppView[];

export type AssignableView = (typeof ASSIGNABLE_VIEWS)[number];

export const VIEW_LABELS: Record<AssignableView, string> = {
  overview: 'Overview',
  board: 'Projects',
  workspace: 'Workspace',
  memoria: 'Memoria',
  network: 'Network',
};

export type UserRole = 'admin' | 'editor' | 'viewer';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  editor: 'Full access',
  viewer: 'Read only',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Full access to every tab, plus user management.',
  editor: 'Can view and change data on the tabs you allow.',
  viewer: 'Can view the tabs you allow, but cannot change anything.',
};

/** The signed-in account, as returned by /api/auth/me. */
export interface CurrentUser {
  username: string;
  role: UserRole | 'service';
  views: AppView[];
  can_write: boolean;
  is_admin: boolean;
}

/** A managed account, as returned by /api/users. */
export interface DashboardUser {
  id: string;
  username: string;
  role: UserRole;
  allowed_views: AppView[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
  allowed_views: AssignableView[];
  is_active?: boolean;
}

export interface UpdateUserInput {
  role?: UserRole;
  allowed_views?: AssignableView[];
  is_active?: boolean;
  password?: string;
}

export interface NetworkHealthPart {
  health?: string;
  power?: string;
  model?: string;
  serial?: string;
  count?: number;
  ok_count?: number;
  size_gib?: number;
  supplies?: { name?: string; health?: string; state?: string | null; watts?: number | null }[];
  [key: string]: unknown;
}

export interface NetworkDeviceHealth {
  system?: NetworkHealthPart;
  processor?: NetworkHealthPart;
  memory?: NetworkHealthPart;
  storage?: NetworkHealthPart;
  power_supply?: NetworkHealthPart;
  sessions?: {
    count?: number | null;
    max?: number | null;
    users?: string[];
  };
}

export interface NetworkSubcloudSnapshot {
  reachable: boolean;
  latency_ms: number | null;
  error: string | null;
  probed_at: string;
}

export type SubcloudPrecheckStatus = 'pass' | 'warn' | 'fail';

export interface SubcloudPrecheckCheck {
  id: string;
  label: string;
  status: SubcloudPrecheckStatus;
  detail: string | null;
}

export interface NetworkSubcloudPrecheckSnapshot {
  status: SubcloudPrecheckStatus;
  platform: string | null;
  summary: string | null;
  checks: SubcloudPrecheckCheck[];
  error: string | null;
  checked_at: string;
  log_file?: string | null;
}

export interface SubcloudPrecheckResult {
  device_id: string;
  cluster_id: string;
  cluster_name: string | null;
  platform: string | null;
  status: SubcloudPrecheckStatus;
  summary: string;
  checks: SubcloudPrecheckCheck[];
  error?: string | null;
  checked_at: string;
  via?: string;
  log_file?: string | null;
  log_error?: string | null;
}

export interface NetworkDeviceSnapshot {
  reachable: boolean;
  latency_ms: number | null;
  redfish_ok: boolean;
  health: NetworkDeviceHealth;
  error: string | null;
  probed_at: string;
}

export interface NetworkDevice {
  id: string;
  cluster_id: string;
  bmc_ip: string;
  oam_ip: string | null;
  subcloud_ip: string | null;
  cluster_name: string | null;
  cluster_namespace: string | null;
  fuze_site_id: string | null;
  site_type: string | null;
  fuze_project_id: string | null;
  owner: string | null;
  os: string | null;
  parent_controller: string | null;
  vendor: string | null;
  model_type: string | null;
  model: string | null;
  application: string | null;
  source_updated_at: string;
  snapshot: NetworkDeviceSnapshot | null;
  subcloud_snapshot: NetworkSubcloudSnapshot | null;
  precheck_snapshot: NetworkSubcloudPrecheckSnapshot | null;
  samsung_precheck_snapshot: NetworkSamsungPrecheckSnapshot | null;
  samsung_upgrade_snapshot: NetworkSamsungPrecheckSnapshot | null;
  samsung_rollback_snapshot: NetworkSamsungPrecheckSnapshot | null;
  samsung_undeployment_snapshot: NetworkSamsungPrecheckSnapshot | null;
  samsung_deployment_snapshot: NetworkSamsungPrecheckSnapshot | null;
  samsung_software_tracker: NetworkSamsungSoftwareTracker | null;
}

export interface NetworkSamsungSoftwareTracker {
  current_release: string | null;
  current_display: string | null;
  current_updated_at: string | null;
  rollback_release: string | null;
  rollback_display: string | null;
  rollback_captured_at: string | null;
  updated_at: string | null;
}

export interface NetworkHostAgentStatus {
  ok: boolean;
  required: boolean;
  url?: string;
  error?: string | null;
  role?: string | null;
}

export interface NetworkDevicesResponse {
  sheet_id: string;
  devices: NetworkDevice[];
  host_agent?: NetworkHostAgentStatus;
}

export interface NetworkVendorSettings {
  vendor: string;
  username: string;
  password_set: boolean;
}

export interface NetworkWrSubcloudSettings {
  username: string;
  password_set: boolean;
  key_path_set: boolean;
  configured: boolean;
}

export interface NetworkWrSubcloudControllerSettings {
  controller: string;
  username: string;
  password_set: boolean;
  configured: boolean;
  device_count: number;
}

export interface NetworkSettingsResponse {
  sheet_id: string;
  vendors: NetworkVendorSettings[];
  wr_subcloud: NetworkWrSubcloudSettings;
  wr_subcloud_controllers?: NetworkWrSubcloudControllerSettings[];
  precheck_custom_commands?: string;
  precheck_log_dir?: string;
  atlas?: NetworkAtlasSettings;
  middleware?: NetworkMiddlewareSettings;
}

export interface NetworkAtlasSettings {
  base_url: string;
  username: string;
  batch_username: string;
  password_set: boolean;
  bearer_token_set?: boolean;
  auth_mode?: 'bearer' | 'basic' | 'none';
  configured: boolean;
  udu_template_id: number;
  vdu_template_id: number;
  udu_undeploy_template_id?: number;
  vdu_undeploy_template_id?: number;
  udu_deploy_template_id?: number;
  vdu_deploy_template_id?: number;
  default_version?: string;
  ciq_sources?: string[];
  default_ciq_source?: string;
  /** SW TAG values from vDU_List → Application SW sheet */
  sw_tags?: string[];
  sw_tags_sheet?: string | null;
  default_sw_tag?: string;
}

export interface SamsungPrecheckActivityEntry {
  id?: number | string;
  timestamp?: string | null;
  summary?: string | null;
  status?: string | null;
  operation?: string | null;
  job_id?: number | null;
  job_kind?: 'job' | 'workflow_job' | null;
}

export interface SamsungPrecheckActivitySummary {
  cluster_id: string;
  status: 'success' | 'failed' | 'pending' | 'running' | 'unknown';
  count: number;
  recent: SamsungPrecheckActivityEntry[];
  error?: string;
}

export interface SamsungPrecheckJobSummary {
  job_id: number | null;
  job_kind?: 'job' | 'workflow_job' | null;
  name?: string | null;
  status: 'success' | 'failed' | 'running' | 'pending' | 'unknown';
  raw_status?: string | null;
  started?: string | null;
  finished?: string | null;
  elapsed?: number | null;
  failed?: boolean;
  terminal?: boolean;
  job_explanation?: string | null;
  error?: string;
}

export type SamsungPrecheckPhase =
  | 'queued'
  | 'running'
  | 'monitoring'
  | 'complete'
  | 'unknown';

export type SamsungPrecheckStatusValue =
  | 'success'
  | 'failed'
  | 'running'
  | 'pending'
  | 'unknown'
  | 'cancelled';

export type SamsungAtlasOperation = 'precheck' | 'upgrade' | 'rollback' | 'undeployment' | 'deployment';

export interface SamsungPrecheckResult {
  device_id: string;
  cluster_id: string;
  operation?: SamsungAtlasOperation;
  workload: 'UDU' | 'VDU';
  template_id: number;
  version: string;
  ciq_source?: string | null;
  job_id: number | null;
  job_kind?: 'job' | 'workflow_job' | null;
  launcher_job_id?: number | null;
  monitor_job_id?: number | null;
  monitor_job_kind?: 'job' | 'workflow_job' | null;
  launch: Record<string, unknown>;
  phase: SamsungPrecheckPhase;
  status: SamsungPrecheckStatusValue;
  message: string;
  job: SamsungPrecheckJobSummary | null;
  launcher_job?: SamsungPrecheckJobSummary | null;
  activity: SamsungPrecheckActivitySummary;
  launched_at: string;
  cleared_prior_atlas?: {
    precheck: boolean;
    upgrade: boolean;
    rollback: boolean;
    rollback_baseline: boolean;
  } | null;
}

export interface SamsungPrecheckStatusResult {
  cluster_id: string | null;
  launcher_job_id?: number | null;
  monitor_job_id?: number | null;
  monitor_job_kind?: 'job' | 'workflow_job' | null;
  job: SamsungPrecheckJobSummary | null;
  launcher_job?: SamsungPrecheckJobSummary | null;
  activity: SamsungPrecheckActivitySummary;
  phase: SamsungPrecheckPhase;
  status: SamsungPrecheckStatusValue;
  message: string;
  error_report?: SamsungPrecheckErrorReport | null;
  launched_at?: string | null;
  checked_at: string;
}

export interface SamsungPrecheckErrorAnalysis {
  root_cause?: string | null;
  summary?: string | null;
  remediation?: string | null;
  provider?: string | null;
  issue_id?: string | null;
  matched_cluster_id?: string | null;
  issue_date?: string | null;
}

export interface SamsungPrecheckErrorReport {
  job_id: number | null;
  name?: string | null;
  detail?: string | null;
  raw_detail?: string | null;
  analysis?: SamsungPrecheckErrorAnalysis | null;
}

export interface SamsungPrecheckRunState {
  device_id: string;
  cluster_id: string;
  operation?: SamsungAtlasOperation;
  version: string;
  ciq_source?: string | null;
  workload: 'UDU' | 'VDU';
  template_id: number;
  job_id: number | null;
  job_kind?: 'job' | 'workflow_job' | null;
  launcher_job_id?: number | null;
  monitor_job_id?: number | null;
  monitor_job_kind?: 'job' | 'workflow_job' | null;
  phase: SamsungPrecheckPhase;
  status: SamsungPrecheckStatusValue;
  message: string;
  job: SamsungPrecheckJobSummary | null;
  launcher_job?: SamsungPrecheckJobSummary | null;
  activity: SamsungPrecheckActivitySummary;
  launched_at: string;
  updated_at: string;
  error?: string | null;
  error_report?: SamsungPrecheckErrorReport | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
}

export interface SamsungAtlasCancelResult {
  device_id: string;
  cluster_id: string;
  operation: SamsungAtlasOperation;
  status: 'cancelled';
  phase: SamsungPrecheckPhase;
  message: string;
  cancelled_at: string;
  cancelled_reason?: string | null;
  updated_at: string;
}

export interface NetworkSamsungPrecheckSnapshot {
  status: SamsungPrecheckStatusValue;
  phase: SamsungPrecheckPhase;
  message: string;
  error?: string | null;
  launched_at: string;
  updated_at: string;
  cluster_id?: string | null;
  workload: 'UDU' | 'VDU';
  version: string;
  ciq_source?: string | null;
  previous_version?: string | null;
  upgrade_target_version?: string | null;
  template_id: number;
  job_kind?: 'job' | 'workflow_job' | null;
  launcher_job_id?: number | null;
  monitor_job_id?: number | null;
  monitor_job_kind?: 'job' | 'workflow_job' | null;
  job: SamsungPrecheckJobSummary | null;
  launcher_job?: SamsungPrecheckJobSummary | null;
  activity: SamsungPrecheckActivitySummary;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
}

export interface NetworkClusterPod {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  node: string | null;
  started_at: string | null;
  reason: string | null;
}

export interface NetworkClusterBuildInfo {
  pod?: string;
  version?: string | null;
  fields?: Record<string, string>;
  files?: { path: string; fields: Record<string, string> }[];
  error?: string | null;
}

export interface NetworkClusterPodsResult {
  device_id: string;
  cluster_id: string;
  cluster_name: string | null;
  cluster_namespace: string;
  platform: string | null;
  total: number;
  running: number;
  not_running: number;
  pods: NetworkClusterPod[];
  software_version?: string | null;
  build_info?: NetworkClusterBuildInfo | null;
  error?: string | null;
  fetched_at: string;
  via?: string;
}

export interface NetworkClusterPodsResponse {
  clusters: NetworkClusterPodsResult[];
  fetched_at: string;
}

export interface NetworkSamsungIssue {
  id: string;
  device_id: string | null;
  issue_name: string;
  cluster_id: string;
  site_type: string | null;
  issue_description: string;
  atlas_job_id: string | null;
  atlas_job_name: string | null;
  issue_date: string;
  resolved_date: string | null;
  resolution_details: string | null;
  user_reporter: string;
  operation: SamsungAtlasOperation;
  created_at: string;
  updated_at: string;
}

export interface NetworkSamsungIssuesResponse {
  issues: NetworkSamsungIssue[];
  total: number;
  limit: number;
  offset: number;
}

export interface NetworkConnectionDetailsResult {
  device_id: string;
  cluster_id: string;
  cluster_name: string;
  url: string;
  data: unknown;
  fetched_at: string;
  via?: string;
}

export interface NetworkSetupClusterResult {
  device_id: string;
  cluster_id: string;
  cluster_name: string;
  url: string;
  data: unknown;
  triggered_at: string;
  via?: string;
}

export interface NetworkMiddlewareSettings {
  configured: boolean;
  via_host?: boolean;
}


export type WorkspaceTab = 'email' | 'calendar' | 'workflows' | 'settings';

export interface WorkspaceSettings {
  email_agent_llm_provider: 'ollama' | 'gemini';
  gemini_api_key?: string;
}

export interface EmailWorkflow {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  trigger_category?: 'important' | 'advertisement' | 'junk' | 'information' | 'any';
  trigger_sender?: string | null;
  trigger_keyword?: string | null;
  action_auto_reply: boolean;
  reply_template?: string | null;
  action_trash_email: boolean;
  action_create_task: boolean;
  task_project_id?: string | null;
  task_title_template?: string | null;
  action_notify_telegram: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailWorkflowInput {
  name: string;
  description?: string;
  is_active?: boolean;
  trigger_category?: string;
  trigger_sender?: string;
  trigger_keyword?: string;
  action_auto_reply?: boolean;
  reply_template?: string;
  action_trash_email?: boolean;
  action_create_task?: boolean;
  task_project_id?: string;
  task_title_template?: string;
  action_notify_telegram?: boolean;
}

export interface EmailWorkflowLog {
  id: string;
  workflow_id: string;
  workflow_name?: string | null;
  message_id: string;
  subject?: string | null;
  from_address?: string | null;
  actions_taken: string[];
  created_at: string;
}

export interface WorkspaceStatus {
  enabled: boolean;
  email: boolean;
  calendar: boolean;
  assistant: 'ollama' | 'gemini' | boolean;
  account: string | null;
}

export interface EmailSummary {
  id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export interface EmailMessage extends EmailSummary {
  body: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  html_link: string | null;
  all_day: boolean;
  status: string;
}

export interface CreateCalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  all_day?: boolean;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
  in_reply_to?: string;
}

export type EmailAssistantCategory =
  | 'important'
  | 'advertisement'
  | 'newsletter'
  | 'notification'
  | 'other';

export interface EmailDraftReply {
  subject: string;
  body: string;
}

export interface EmailAssistantReview {
  message_id: string;
  category: EmailAssistantCategory;
  needs_reply: boolean;
  should_delete: boolean;
  summary: string;
  reasoning: string;
  draft_reply: EmailDraftReply | null;
  subject?: string;
  from?: string;
  error?: string;
}

export interface EmailAssistantScanResult {
  reviews: EmailAssistantReview[];
  scanned: number;
}

export interface EmailCleanupDeleted {
  message_id: string;
  subject: string;
  from: string;
}

export interface EmailCleanupError {
  message_id: string;
  subject: string;
  error: string;
}

export interface EmailAssistantCleanupResult {
  scanned: number;
  deleted: number;
  skipped: number;
  deleted_messages: EmailCleanupDeleted[];
  errors: EmailCleanupError[];
}

export interface EmailAgentReview {
  id: string;
  message_id: string;
  thread_id?: string;
  from_address: string;
  subject?: string;
  body_snippet?: string;
  category: 'important' | 'advertisement' | 'junk' | 'information';
  needs_reply: boolean;
  proposed_subject?: string;
  proposed_body?: string;
  status: 'pending' | 'approved' | 'rejected' | 'sent';
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSettings {
  email_agent_llm_provider: 'ollama' | 'gemini';
  gemini_api_key?: string;
}
