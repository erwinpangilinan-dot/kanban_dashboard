export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

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

export type AppView = 'overview' | 'board';
