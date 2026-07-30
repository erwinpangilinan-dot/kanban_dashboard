const db = require('../db');
const workspaceEmail = require('./workspace-email');
const telegram = require('./telegram');

async function getWorkflows() {
  const { rows } = await db.query(
    'SELECT * FROM email_workflows ORDER BY created_at DESC'
  );
  return rows;
}

async function createWorkflow(input) {
  const {
    name,
    description,
    is_active = true,
    trigger_category = 'any',
    trigger_sender,
    trigger_keyword,
    action_auto_reply = false,
    reply_template,
    action_trash_email = false,
    action_create_task = false,
    task_project_id,
    task_title_template,
    action_notify_telegram = false,
  } = input;

  if (!name || !name.trim()) throw new Error('Workflow name is required');

  const { rows } = await db.query(
    `INSERT INTO email_workflows (
      name, description, is_active, trigger_category, trigger_sender, trigger_keyword,
      action_auto_reply, reply_template, action_trash_email, action_create_task,
      task_project_id, task_title_template, action_notify_telegram
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      name.trim(),
      description || null,
      is_active,
      trigger_category || 'any',
      trigger_sender || null,
      trigger_keyword || null,
      action_auto_reply,
      reply_template || null,
      action_trash_email,
      action_create_task,
      task_project_id || null,
      task_title_template || null,
      action_notify_telegram,
    ]
  );
  return rows[0];
}

async function updateWorkflow(id, input) {
  const fields = [];
  const values = [];
  let paramIdx = 1;

  const allowedKeys = [
    'name', 'description', 'is_active', 'trigger_category', 'trigger_sender',
    'trigger_keyword', 'action_auto_reply', 'reply_template', 'action_trash_email',
    'action_create_task', 'task_project_id', 'task_title_template', 'action_notify_telegram'
  ];

  for (const key of allowedKeys) {
    if (input[key] !== undefined) {
      fields.push(`${key} = $${paramIdx++}`);
      values.push(input[key]);
    }
  }

  if (fields.length === 0) throw new Error('No valid fields provided for update');

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const { rows } = await db.query(
    `UPDATE email_workflows SET ${fields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );

  if (rows.length === 0) throw new Error('Workflow not found');
  return rows[0];
}

async function deleteWorkflow(id) {
  const { rowCount } = await db.query('DELETE FROM email_workflows WHERE id = $1', [id]);
  if (!rowCount) throw new Error('Workflow not found');
  return { success: true };
}

async function getWorkflowLogs(limit = 50) {
  const { rows } = await db.query(
    `SELECT l.*, w.name as workflow_name
     FROM email_workflow_logs l
     LEFT JOIN email_workflows w ON l.workflow_id = w.id
     ORDER BY l.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function evaluateWorkflowsForEmail(msg, category, bodySnippet = '') {
  const { rows: workflows } = await db.query(
    'SELECT * FROM email_workflows WHERE is_active = TRUE ORDER BY created_at ASC'
  );

  if (!workflows.length) return [];

  const executed = [];

  for (const wf of workflows) {
    // 1. Check Category Match
    if (wf.trigger_category && wf.trigger_category !== 'any' && wf.trigger_category !== category) {
      continue;
    }

    // 2. Check Sender Match
    if (wf.trigger_sender && wf.trigger_sender.trim()) {
      const pattern = wf.trigger_sender.trim().toLowerCase();
      const fromAddr = (msg.from || '').toLowerCase();
      if (!fromAddr.includes(pattern)) continue;
    }

    // 3. Check Keyword Match
    if (wf.trigger_keyword && wf.trigger_keyword.trim()) {
      const kw = wf.trigger_keyword.trim().toLowerCase();
      const subjectText = (msg.subject || '').toLowerCase();
      const bodyText = (bodySnippet || '').toLowerCase();
      if (!subjectText.includes(kw) && !bodyText.includes(kw)) continue;
    }

    // Match found! Execute actions.
    const actionsTaken = [];

    // Action A: Create Task in Kanban
    if (wf.action_create_task) {
      try {
        let projectId = wf.task_project_id;
        if (!projectId) {
          const { rows: defaultProjects } = await db.query('SELECT id FROM projects LIMIT 1');
          if (defaultProjects.length) projectId = defaultProjects[0].id;
        }

        if (projectId) {
          const { rows: boards } = await db.query(
            'SELECT id FROM boards WHERE project_id = $1 LIMIT 1',
            [projectId]
          );
          if (boards.length) {
            const { rows: cols } = await db.query(
              "SELECT id FROM columns WHERE board_id = $1 AND name IN ('To Do', 'Backlog') ORDER BY position ASC LIMIT 1",
              [boards[0].id]
            );
            if (cols.length) {
              const taskTitle = wf.task_title_template
                ? wf.task_title_template.replace('{{subject}}', msg.subject || 'No Subject')
                : `Email: ${msg.subject || 'Untitled'}`;

              await db.query(
                `INSERT INTO tasks (column_id, title, description, priority, assignee, position)
                 VALUES ($1, $2, $3, $4, $5, 0)`,
                [
                  cols[0].id,
                  taskTitle.slice(0, 255),
                  `Automated workflow: ${wf.name}\nFrom: ${msg.from}\n\n${(bodySnippet || '').slice(0, 1000)}`,
                  'medium',
                  'Email Agent'
                ]
              );
              actionsTaken.push(`Created Kanban Task: "${taskTitle}"`);
            }
          }
        }
      } catch (err) {
        console.error(`Workflow ${wf.id} create task failed:`, err.message);
      }
    }

    // Action B: Auto-Reply Draft / Send
    if (wf.action_auto_reply) {
      try {
        const replyBody = wf.reply_template || 'Thank you for your message. This automated confirmation was generated by Erwin Pangilinan\'s Email Agent.';
        await workspaceEmail.sendMessage({
          to: msg.from,
          subject: `Re: ${msg.subject || ''}`,
          body: replyBody,
          threadId: msg.thread_id
        });
        actionsTaken.push(`Sent auto-reply to ${msg.from}`);
      } catch (err) {
        console.error(`Workflow ${wf.id} auto-reply failed:`, err.message);
      }
    }

    // Action C: Telegram Notification
    if (wf.action_notify_telegram) {
      try {
        const notificationText = `<b>⚡ Email Automation Alert</b>\n<b>Rule:</b> ${wf.name}\n<b>From:</b> ${msg.from}\n<b>Subject:</b> ${msg.subject || '(No Subject)'}`;
        await telegram.sendMessage(notificationText);
        actionsTaken.push('Sent Telegram Notification');
      } catch (err) {
        console.error(`Workflow ${wf.id} Telegram notify failed:`, err.message);
      }
    }

    // Action D: Trash Email
    if (wf.action_trash_email) {
      try {
        await workspaceEmail.deleteMessage(msg.id);
        actionsTaken.push('Trashed Email Message');
      } catch (err) {
        console.error(`Workflow ${wf.id} trash email failed:`, err.message);
      }
    }

    // Record log entry
    if (actionsTaken.length > 0) {
      await db.query(
        `INSERT INTO email_workflow_logs (workflow_id, message_id, subject, from_address, actions_taken)
         VALUES ($1, $2, $3, $4, $5)`,
        [wf.id, msg.id, msg.subject, msg.from, actionsTaken]
      );
      executed.push({ workflow_name: wf.name, actions_taken: actionsTaken });
    }
  }

  return executed;
}

module.exports = {
  getWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowLogs,
  evaluateWorkflowsForEmail,
};
