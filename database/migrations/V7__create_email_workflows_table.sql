-- Email Workflow Automation Schema

CREATE TABLE IF NOT EXISTS email_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  trigger_category VARCHAR(50) DEFAULT 'any', -- important, advertisement, junk, information, any
  trigger_sender VARCHAR(255),
  trigger_keyword VARCHAR(255),
  action_auto_reply BOOLEAN DEFAULT FALSE,
  reply_template TEXT,
  action_trash_email BOOLEAN DEFAULT FALSE,
  action_create_task BOOLEAN DEFAULT FALSE,
  task_project_id UUID,
  task_title_template VARCHAR(255),
  action_notify_telegram BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_workflow_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES email_workflows(id) ON DELETE CASCADE,
  message_id VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  from_address VARCHAR(255),
  actions_taken TEXT[],
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_workflows_active ON email_workflows(is_active);
CREATE INDEX IF NOT EXISTS idx_email_workflow_logs_workflow_id ON email_workflow_logs(workflow_id);
