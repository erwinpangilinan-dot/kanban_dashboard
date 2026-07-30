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


export type AppView = 'overview' | 'board' | 'workspace' | 'memoria';


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
