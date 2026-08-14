/** Inspect ComputerSystem.Reset AllowableValues and recent power. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { getVendorCredentials } = require('../src/services/network-credentials');
const https = require('https');

function redfish(host, creds, method, p, body) {
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: p,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        rejectUnauthorized: false,
        timeout: 20000,
        family: 6,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw: raw.slice(0, 400) };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const clusterId = process.argv[2];
  const doReset = process.argv[3]; // optional ResetType to POST
  const { rows } = await db.query(
    'SELECT bmc_ip, vendor FROM network_devices WHERE cluster_id = $1',
    [clusterId]
  );
  const d = rows[0];
  const creds = await getVendorCredentials(d.vendor || 'DELL');
  const sys = await redfish(d.bmc_ip, creds, 'GET', '/redfish/v1/Systems/System.Embedded.1');
  const action = sys.json?.Actions?.['#ComputerSystem.Reset'] || {};
  console.log(
    JSON.stringify(
      {
        power: sys.json?.PowerState,
        reset_action: action,
        allowable:
          action['ResetType@Redfish.AllowableValues'] ||
          action['ResetType@AllowableValues'] ||
          null,
      },
      null,
      2
    )
  );

  if (doReset) {
    const target = action.target || '/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset';
    const result = await redfish(d.bmc_ip, creds, 'POST', target, { ResetType: doReset });
    console.log('POST_RESET', JSON.stringify(result, null, 2));
    await new Promise((r) => setTimeout(r, 5000));
    const after = await redfish(d.bmc_ip, creds, 'GET', '/redfish/v1/Systems/System.Embedded.1');
    console.log('POWER_AFTER_5S', after.json?.PowerState);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
