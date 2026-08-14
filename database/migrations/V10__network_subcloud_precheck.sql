-- Subcloud OS/cluster metadata + precheck snapshots

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS os TEXT,
  ADD COLUMN IF NOT EXISTS cluster_name TEXT;

CREATE INDEX IF NOT EXISTS idx_network_devices_cluster_name ON network_devices (cluster_name);
CREATE INDEX IF NOT EXISTS idx_network_devices_os ON network_devices (os);

CREATE TABLE IF NOT EXISTS network_subcloud_precheck_snapshots (
  device_id UUID PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  platform TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
