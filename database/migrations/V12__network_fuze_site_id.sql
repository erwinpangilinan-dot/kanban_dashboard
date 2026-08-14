-- Fuze SiteID from vDU_List; used to refresh subcloud fields from Far-Edge middleware

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS fuze_site_id TEXT;

CREATE INDEX IF NOT EXISTS idx_network_devices_fuze_site_id ON network_devices (fuze_site_id);
