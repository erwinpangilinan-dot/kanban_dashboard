ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS parent_controller TEXT;

CREATE INDEX IF NOT EXISTS idx_network_devices_parent_controller
  ON network_devices (parent_controller);
