-- FUZE project ID from vDU_List; required survey field for some Atlas
-- Samsung deployment workflow job templates (distinct from Fuze SiteID).

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS fuze_project_id TEXT;
