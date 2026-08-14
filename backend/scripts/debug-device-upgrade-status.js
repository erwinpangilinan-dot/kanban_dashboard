/**
 * Debug Samsung Atlas upgrade status for a gNB DUID.
 * Usage: node backend/scripts/debug-device-upgrade-status.js 29991573163
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
} = require('../src/services/network-samsung-precheck');

async function main() {
  const clusterId = process.argv[2];
  if (!clusterId) {
    console.error('Usage: node debug-device-upgrade-status.js <gNB DUID>');
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT id, cluster_id, cluster_name, application, cluster_namespace
     FROM network_devices WHERE cluster_id = $1`,
    [clusterId]
  );
  const device = rows[0];
  if (!device) {
    console.error('Device not found:', clusterId);
    process.exit(1);
  }

  console.log('Device:', device);

  for (const op of ['precheck', 'upgrade', 'rollback']) {
    const snap = await loadSamsungAtlasSnapshot(device.id, op);
    console.log(`\n--- ${op} snapshot ---`);
    console.log(JSON.stringify(snap, null, 2));
  }

  const upgradeSnap = await loadSamsungAtlasSnapshot(device.id, 'upgrade');
  if (upgradeSnap) {
    console.log('\n--- live Atlas upgrade status ---');
    const status = await getSamsungPrecheckStatus({
      clusterId: device.cluster_id,
      operation: 'upgrade',
      launcherJobId: upgradeSnap.launcher_job_id,
      monitorJobId: upgradeSnap.monitor_job_id,
      monitorJobKind: upgradeSnap.monitor_job_kind,
      launchedAfter: upgradeSnap.launched_at,
      workload: upgradeSnap.workload,
    });
    console.log(JSON.stringify(status, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
