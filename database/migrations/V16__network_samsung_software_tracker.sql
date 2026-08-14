-- Per-device Samsung software tracker: current installed release + rollback baseline (captured at precheck).

CREATE TABLE IF NOT EXISTS network_samsung_software_tracker (
  device_id UUID PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  current_release TEXT,
  current_display TEXT,
  current_updated_at TIMESTAMPTZ,
  rollback_release TEXT,
  rollback_display TEXT,
  rollback_captured_at TIMESTAMPTZ,
  build_info JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_samsung_sw_tracker_cluster
  ON network_samsung_software_tracker (cluster_id);

-- Known baseline for 29991572163 (pre-upgrade before 26.A.0-0200 upgrade on 2026-08-06).
INSERT INTO network_samsung_software_tracker (
  device_id,
  cluster_id,
  current_release,
  current_display,
  current_updated_at,
  rollback_release,
  rollback_display,
  rollback_captured_at,
  build_info,
  updated_at
)
SELECT
  d.id,
  d.cluster_id,
  '26.A.0-0200',
  'UDU.26A.P2.00',
  NOW(),
  '26.A.0-0110',
  'UDU.26A.P1.10',
  '2026-08-06T20:10:00Z'::timestamptz,
  '{"PKG_VER":"26.A.0","REL_VER":"r-0200","source":"migration_seed"}'::jsonb,
  NOW()
FROM network_devices d
WHERE d.cluster_id = '29991572163'
ON CONFLICT (device_id) DO UPDATE SET
  rollback_release = EXCLUDED.rollback_release,
  rollback_display = EXCLUDED.rollback_display,
  rollback_captured_at = EXCLUDED.rollback_captured_at,
  current_release = EXCLUDED.current_release,
  current_display = EXCLUDED.current_display,
  current_updated_at = EXCLUDED.current_updated_at,
  build_info = EXCLUDED.build_info,
  updated_at = NOW();
