#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  api,
  findColumnByName,
  formatStatusReport,
  jsonResult,
  textResult,
} from './api.js';

const server = new McpServer({
  name: 'mission-control',
  version: '1.0.0',
});

// ── Health ────────────────────────────────────────────────────────────────────

server.tool(
  'health_check',
  'Verify Mission Control API is reachable and database is connected.',
  {},
  async () => {
    const data = await api('/health');
    return textResult(`Mission Control is ${data.status}. Database: ${data.database}.`);
  }
);

// ── Read status ───────────────────────────────────────────────────────────────

server.tool(
  'get_overview',
  'Get global mission metrics, project widgets, upcoming deadlines, and recent activity.',
  {},
  async () => jsonResult(await api('/overview'))
);

server.tool(
  'get_status_report',
  'Get a markdown-formatted coordination report suitable for standups or status updates.',
  {},
  async () => textResult(formatStatusReport(await api('/overview')))
);

server.tool(
  'list_projects',
  'List all projects with basic metadata.',
  {},
  async () => jsonResult(await api('/projects'))
);

server.tool(
  'get_board',
  'Get the full Kanban board for a project including columns and tasks.',
  { project_id: z.string().uuid().describe('Project UUID') },
  async ({ project_id }) => jsonResult(await api(`/projects/${project_id}/board`))
);

server.tool(
  'get_activity',
  'Get recent task activity log across all projects.',
  {
    limit: z.number().int().min(1).max(50).optional().describe('Max entries (default 20 from overview)'),
  },
  async () => {
    const overview = await api('/overview');
    const activity = overview.activity;
    return jsonResult(activity);
  }
);

// ── Projects ──────────────────────────────────────────────────────────────────

server.tool(
  'create_project',
  'Create a new project with default Kanban board (Backlog, To Do, In Progress, Review, Done).',
  {
    name: z.string().min(1).describe('Project name'),
    description: z.string().optional().describe('Project description'),
    color: z.string().optional().describe('Hex color e.g. #6366f1'),
  },
  async (args) => jsonResult(await api('/projects', { method: 'POST', body: JSON.stringify(args) }))
);

// ── Tasks ─────────────────────────────────────────────────────────────────────

server.tool(
  'create_task',
  'Create a task in a project column by column name.',
  {
    project_id: z.string().uuid().describe('Project UUID'),
    column_name: z
      .string()
      .describe('Column name: Backlog, To Do, In Progress, Review, or Done'),
    title: z.string().min(1).describe('Task title'),
    description: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignee: z.string().optional(),
    due_date: z.string().optional().describe('ISO date YYYY-MM-DD'),
  },
  async ({ project_id, column_name, ...task }) => {
    const { column } = await findColumnByName(project_id, column_name);
    const created = await api(`/columns/${column.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify(task),
    });
    return jsonResult(created);
  }
);

server.tool(
  'update_task',
  'Update task fields (title, description, priority, assignee, due_date).',
  {
    task_id: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignee: z.string().nullable().optional(),
    due_date: z.string().nullable().optional().describe('YYYY-MM-DD or null to clear'),
  },
  async ({ task_id, ...fields }) =>
    jsonResult(await api(`/tasks/${task_id}`, { method: 'PUT', body: JSON.stringify(fields) }))
);

server.tool(
  'move_task',
  'Move a task to another column by column name. Updates board position automatically.',
  {
    project_id: z.string().uuid().describe('Project UUID the task belongs to'),
    task_id: z.string().uuid(),
    column_name: z.string().describe('Target column: Backlog, To Do, In Progress, Review, Done'),
    position: z.number().int().min(0).optional().describe('Position in column (default: end)'),
  },
  async ({ project_id, task_id, column_name, position }) => {
    const { board, column: targetCol } = await findColumnByName(project_id, column_name);
    let pos = position;
    if (pos === undefined) {
      pos = targetCol.tasks?.length ?? 0;
    }
    const moved = await api(`/tasks/${task_id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ column_id: targetCol.id, position: pos }),
    });
    return jsonResult(moved);
  }
);

server.tool(
  'complete_task',
  'Mark a task complete by moving it to Done.',
  {
    project_id: z.string().uuid(),
    task_id: z.string().uuid(),
  },
  async ({ project_id, task_id }) => {
    const { column } = await findColumnByName(project_id, 'Done');
    const moved = await api(`/tasks/${task_id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ column_id: column.id, position: 0 }),
    });
    return textResult(`Task "${moved.title}" moved to Done.`);
  }
);

server.tool(
  'delete_task',
  'Permanently delete a task.',
  { task_id: z.string().uuid() },
  async ({ task_id }) => {
    await api(`/tasks/${task_id}`, { method: 'DELETE' });
    return textResult(`Task ${task_id} deleted.`);
  }
);

// ── Prompts ───────────────────────────────────────────────────────────────────

server.prompt(
  'standup_summary',
  'Generate a standup-ready summary from current Mission Control data.',
  {},
  async () => {
    const report = formatStatusReport(await api('/overview'));
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Using this Mission Control data, write a concise standup update (what is done, in progress, blocked, due soon):\n\n${report}`,
          },
        },
      ],
    };
  }
);

server.prompt(
  'coordination_check',
  'Review project health and flag risks from Mission Control metrics.',
  {
    project_name: z.string().optional().describe('Focus on one project, or all if omitted'),
  },
  async ({ project_name }) => {
    const overview = await api('/overview');
    let report = formatStatusReport(overview);
    if (project_name) {
      const p = overview.projects.find(
        (x) => x.name.toLowerCase() === project_name.toLowerCase()
      );
      report = p
        ? `# ${p.name}\nProgress: ${p.progress_percent}%\nActive: ${p.active}\nOverdue: ${p.overdue}\nIn progress: ${p.in_progress}`
        : `Project "${project_name}" not found.`;
    }
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review this Mission Control status and identify risks, blockers, and recommended next actions:\n\n${report}`,
          },
        },
      ],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
