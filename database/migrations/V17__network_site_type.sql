-- Site type from vDU_List (e.g. UDU / VDU); used as a Samsung workload hint
-- when pod-name detection is unavailable (e.g. before first deployment).

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS site_type TEXT;
