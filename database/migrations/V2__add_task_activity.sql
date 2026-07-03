-- Activity log for overview metrics and feed

CREATE TABLE IF NOT EXISTS task_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    task_title VARCHAR(500),
    from_column VARCHAR(100),
    to_column VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_activity_project ON task_activity(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_created ON task_activity(created_at DESC);
