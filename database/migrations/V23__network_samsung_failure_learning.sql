-- Persist Ollama Atlas failure analyses and operator corrections for few-shot reuse.
-- Improves drill-down over time without model fine-tuning / RL.

CREATE TABLE IF NOT EXISTS network_samsung_failure_learning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id TEXT,
  operation TEXT NOT NULL
    CHECK (operation IN ('precheck', 'deployment', 'upgrade', 'rollback', 'undeployment')),
  atlas_job_id TEXT,
  job_name TEXT,
  signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_detail TEXT,
  ollama_root_cause TEXT,
  ollama_summary TEXT,
  ollama_remediation TEXT,
  -- Filled when an operator records/edits Issues-tab resolution_details
  operator_remediation TEXT,
  issue_id UUID REFERENCES network_samsung_issue_log(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'ollama'
    CHECK (source IN ('ollama', 'correction', 'issues')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_samsung_failure_learning_op
  ON network_samsung_failure_learning (operation, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_samsung_failure_learning_cluster
  ON network_samsung_failure_learning (cluster_id);

CREATE INDEX IF NOT EXISTS idx_network_samsung_failure_learning_issue
  ON network_samsung_failure_learning (issue_id)
  WHERE issue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_network_samsung_failure_learning_sigs
  ON network_samsung_failure_learning USING GIN (signatures);
