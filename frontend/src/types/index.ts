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

export type AppView = 'overview' | 'board' | 'workspace';

export type WorkspaceTab = 'email' | 'calendar';

export interface WorkspaceStatus {
  enabled: boolean;
  email: boolean;
  calendar: boolean;
  assistant: boolean;
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
