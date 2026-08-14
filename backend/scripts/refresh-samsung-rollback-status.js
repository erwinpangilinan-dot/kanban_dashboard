/**
 * Refresh Samsung rollback status for a cluster and persist snapshot.
 * Usage: node backend/scripts/refresh-samsung-rollback-status.js [cluster_id]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const {
  getSamsungPrecheckStatus,
  loadSamsungAtlasSnapshot,
  persistSamsungAtlasStatus,
} = require('../src/services/network-samsung-precheck');

const clusterId = process.argv[2] || '29991572163';

async function main() {
  const { rows } = await db.query(
    `SELECT * FROM network_devices WHERE cluster_id = $1 LIMIT 1`,
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error(`Device not found for cluster ${clusterId}`);

  const stored = await loadSamsungAtlasSnapshot(device.id, 'rollback');
  const status = await getSamsungPrecheckStatus({
    clusterId: device.cluster_id,
    launchedAfter: stored?.launched_at,
    launcherJobId: stored?.launcher_job_id,
    monitorJobId: stored?.monitor_job_id,
    monitorJobKind: stored?.monitor_job_kind,
    operation: 'rollback',
  });

  await persistSamsungAtlasStatus(device.id, device, status, stored, 'rollback');

  console.log(
    JSON.stringify(
      {
        device_id: device.id,
        cluster_id: device.cluster_id,
        phase: status.phase,
        status: status.status,
        message: status.message,
        monitor_job_id: status.monitor_job_id,
        error_report: status.error_report,
        persisted: true,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
