-- Workspace Settings Table

CREATE TABLE IF NOT EXISTS workspace_settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO workspace_settings (key, value)
VALUES ('email_agent_llm_provider', 'ollama')
ON CONFLICT (key) DO NOTHING;
