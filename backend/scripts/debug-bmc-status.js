/**
 * Print BMC/Redfish status for a gNB DUID.
 * Usage: node backend/scripts/debug-bmc-status.js 29991572820
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');

async function main() {
  const clusterId = process.argv[2];
  if (!clusterId) {
    console.error('Usage: node debug-bmc-status.js <gNB DUID>');
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT d.cluster_id, d.cluster_name, d.vendor, d.bmc_ip, d.application, d.model,
            s.reachable, s.latency_ms, s.redfish_ok, s.health, s.error, s.probed_at
     FROM network_devices d
     LEFT JOIN network_device_snapshots s ON s.device_id = d.id
     WHERE d.cluster_id = $1`,
    [clusterId]
  );

  if (!rows.length) {
    console.error('Device not found:', clusterId);
    process.exit(1);
  }

  console.log(JSON.stringify(rows[0], null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
