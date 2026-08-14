/** Live Redfish power check. Usage: node backend/scripts/live-bmc-power.js 29991573174 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { getVendorCredentials } = require('../src/services/network-credentials');
const { probeDevice } = require('../src/services/network-probe');

async function main() {
  const clusterId = process.argv[2];
  const { rows } = await db.query(
    'SELECT cluster_id, bmc_ip, vendor FROM network_devices WHERE cluster_id = $1',
    [clusterId]
  );
  const d = rows[0];
  if (!d) throw new Error('not found');
  const creds = await getVendorCredentials(d.vendor || 'DELL');
  const result = await probeDevice(d.bmc_ip, creds, d.vendor);
  console.log(
    JSON.stringify(
      {
        cluster_id: d.cluster_id,
        bmc_ip: d.bmc_ip,
        reachable: result.reachable,
        redfish_ok: result.redfish_ok,
        power: result.health?.system?.power,
        health: result.health?.system?.health,
        error: result.error || null,
        latency_ms: result.latency_ms,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
