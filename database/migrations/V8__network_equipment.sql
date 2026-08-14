-- Network equipment inventory (vDU list) + Redfish/connectivity snapshots

CREATE TABLE IF NOT EXISTS network_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id TEXT NOT NULL UNIQUE,
  bmc_ip TEXT NOT NULL,
  oam_ip TEXT,
  vendor TEXT,
  model_type TEXT,
  model TEXT,
  application TEXT,
  source_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_devices_bmc_ip ON network_devices (bmc_ip);
CREATE INDEX IF NOT EXISTS idx_network_devices_vendor ON network_devices (vendor);

CREATE TABLE IF NOT EXISTS network_device_snapshots (
  device_id UUID PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  reachable BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER,
  redfish_ok BOOLEAN NOT NULL DEFAULT FALSE,
  health JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Placeholder keys for per-vendor Redfish credentials (values set via API/UI)
INSERT INTO workspace_settings (key, value)
VALUES
  ('redfish_dell_username', ''),
  ('redfish_dell_password', '')
ON CONFLICT (key) DO NOTHING;
