-- Samsung Atlas precheck: last run per device (persists across browser refresh)

CREATE TABLE IF NOT EXISTS network_samsung_precheck_snapshots (
  device_id UUID PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  phase TEXT,
  message TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  launched_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_samsung_precheck_updated
  ON network_samsung_precheck_snapshots (updated_at DESC);
