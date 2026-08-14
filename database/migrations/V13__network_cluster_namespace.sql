-- Kubernetes / vDU namespace from vDU_List + Far-Edge middleware

ALTER TABLE network_devices
  ADD COLUMN IF NOT EXISTS cluster_namespace TEXT;

CREATE INDEX IF NOT EXISTS idx_network_devices_cluster_namespace ON network_devices (cluster_namespace);
