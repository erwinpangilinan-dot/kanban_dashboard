-- Subcloud IP from vDU_List + ICMP ping snapshots

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS subcloud_ip TEXT;

CREATE INDEX IF NOT EXISTS idx_network_devices_subcloud_ip ON network_devices (subcloud_ip);

CREATE TABLE IF NOT EXISTS network_subcloud_snapshots (
  device_id UUID PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  reachable BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER,
  error TEXT,
  probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
