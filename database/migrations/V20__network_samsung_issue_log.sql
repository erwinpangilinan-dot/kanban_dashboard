-- Append-only log of Samsung Atlas action failures (Pods tab operations).
-- Resolved date / resolution details are user-editable; other fields are write-once.

CREATE TABLE IF NOT EXISTS network_samsung_issue_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES network_devices(id) ON DELETE SET NULL,
  issue_name TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  site_type TEXT,
  issue_description TEXT NOT NULL DEFAULT '',
  atlas_job_id TEXT,
  issue_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_date TIMESTAMPTZ,
  resolution_details TEXT,
  user_reporter TEXT NOT NULL DEFAULT 'system',
  operation TEXT NOT NULL
    CHECK (operation IN ('precheck', 'deployment', 'upgrade', 'rollback', 'undeployment')),
  -- Idempotency: job:<id> or launch:<device>:<op>:<launched_at>
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT network_samsung_issue_log_dedupe_key_unique UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_network_samsung_issue_log_issue_date
  ON network_samsung_issue_log (issue_date DESC);

CREATE INDEX IF NOT EXISTS idx_network_samsung_issue_log_cluster_id
  ON network_samsung_issue_log (cluster_id);

CREATE INDEX IF NOT EXISTS idx_network_samsung_issue_log_open
  ON network_samsung_issue_log (resolved_date NULLS FIRST, issue_date DESC);

CREATE INDEX IF NOT EXISTS idx_network_samsung_issue_log_operation
  ON network_samsung_issue_log (operation);
