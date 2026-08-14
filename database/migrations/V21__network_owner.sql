-- Site owner from vDU_List "Owner" column; used to filter BMC / Subcloud / Pods views.

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS owner TEXT;

CREATE INDEX IF NOT EXISTS idx_network_devices_owner ON network_devices (owner);
