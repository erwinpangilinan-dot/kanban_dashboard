-- Allow separate precheck vs upgrade Atlas snapshots per device

ALTER TABLE network_samsung_precheck_snapshots
  ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'precheck';

-- Re-writable only when PK is still the original single-column key (or missing).
-- Plain ADD PRIMARY KEY is not idempotent and crash-loops API restarts after first apply.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'network_samsung_precheck_snapshots'
      AND c.contype = 'p'
      AND array_length(c.conkey, 1) = 1
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'network_samsung_precheck_snapshots'
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE network_samsung_precheck_snapshots
      DROP CONSTRAINT IF EXISTS network_samsung_precheck_snapshots_pkey;
    ALTER TABLE network_samsung_precheck_snapshots
      ADD PRIMARY KEY (device_id, operation);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_network_samsung_atlas_updated
  ON network_samsung_precheck_snapshots (operation, updated_at DESC);
