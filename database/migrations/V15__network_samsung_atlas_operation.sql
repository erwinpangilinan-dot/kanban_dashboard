-- Allow separate precheck vs upgrade Atlas snapshots per device

ALTER TABLE network_samsung_precheck_snapshots
  ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'precheck';

ALTER TABLE network_samsung_precheck_snapshots
  DROP CONSTRAINT IF EXISTS network_samsung_precheck_snapshots_pkey;

ALTER TABLE network_samsung_precheck_snapshots
  ADD PRIMARY KEY (device_id, operation);

CREATE INDEX IF NOT EXISTS idx_network_samsung_atlas_updated
  ON network_samsung_precheck_snapshots (operation, updated_at DESC);
