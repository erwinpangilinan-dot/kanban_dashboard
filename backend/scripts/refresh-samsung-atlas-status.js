/**
 * Refresh Samsung Atlas status snapshot for a cluster/operation.
 * Usage: node backend/scripts/refresh-samsung-atlas-status.js [cluster_id] [precheck|upgrade|rollback]
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
  normalizeAtlasOperation,
} = require('../src/services/network-samsung-precheck');

const clusterId = process.argv[2];
const operation = normalizeAtlasOperation(process.argv[3] || 'precheck');

async function main() {
  if (!clusterId) throw new Error('cluster_id required');
  const { rows } = await db.query(
    'SELECT * FROM network_devices WHERE cluster_id = $1 LIMIT 1',
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error(`Device not found for cluster ${clusterId}`);

  const stored = await loadSamsungAtlasSnapshot(device.id, operation);
  const status = await getSamsungPrecheckStatus({
    clusterId: device.cluster_id,
    launchedAfter: stored?.launched_at,
    launcherJobId: stored?.launcher_job_id,
    monitorJobId: stored?.monitor_job_id,
    monitorJobKind: stored?.monitor_job_kind,
    operation,
    workload: stored?.workload,
  });

  await persistSamsungAtlasStatus(device.id, device, status, stored, operation);
  console.log(
    JSON.stringify(
      {
        cluster_id: device.cluster_id,
        operation,
        phase: status.phase,
        status: status.status,
        message: status.message,
        monitor_job_id: status.monitor_job_id,
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
