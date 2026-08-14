/** Discover Redfish Systems paths/actions. Usage: node backend/scripts/discover-redfish-system.js 29991573174 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { getVendorCredentials } = require('../src/services/network-credentials');

async function redfishGet(host, creds, p) {
  const url = `https://[${host}]${p}`;
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    // @ts-ignore
    rejectUnauthorized: false,
  }).catch(async (err) => {
    // Node fetch needs undici dispatcher for insecure; fall back via https
    const https = require('https');
    return await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          path: p,
          method: 'GET',
          headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
          rejectUnauthorized: false,
          timeout: 15000,
          family: 6,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve({ status: res.statusCode, text: raw }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  });

  if (res.text != null) {
    let json = null;
    try {
      json = res.text ? JSON.parse(res.text) : null;
    } catch {
      json = { raw: res.text.slice(0, 300) };
    }
    return { status: res.status, json };
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function main() {
  const clusterId = process.argv[2];
  const { rows } = await db.query(
    'SELECT cluster_id, bmc_ip, vendor, model FROM network_devices WHERE cluster_id = $1',
    [clusterId]
  );
  const d = rows[0];
  if (!d) throw new Error('not found');
  const creds = await getVendorCredentials(d.vendor || 'DELL');
  if (!creds.configured) throw new Error('creds missing');

  const root = await redfishGet(d.bmc_ip, creds, '/redfish/v1/');
  const systems = await redfishGet(d.bmc_ip, creds, '/redfish/v1/Systems');
  const members = systems.json?.Members || [];
  const details = [];
  for (const m of members.slice(0, 5)) {
    const href = m['@odata.id'];
    if (!href) continue;
    const sys = await redfishGet(d.bmc_ip, creds, href);
    details.push({
      path: href,
      status: sys.status,
      name: sys.json?.Name,
      manufacturer: sys.json?.Manufacturer,
      model: sys.json?.Model,
      power: sys.json?.PowerState,
      actions: Object.keys(sys.json?.Actions || {}),
      resetTarget: sys.json?.Actions?.['#ComputerSystem.Reset']?.target || null,
    });
  }

  const embedded = await redfishGet(
    d.bmc_ip,
    creds,
    '/redfish/v1/Systems/System.Embedded.1'
  );

  console.log(
    JSON.stringify(
      {
        device: { cluster_id: d.cluster_id, vendor: d.vendor, model: d.model, bmc_ip: d.bmc_ip },
        root_vendor: root.json?.Vendor || root.json?.Oem || null,
        root_product: root.json?.Product || root.json?.Name || null,
        systems_status: systems.status,
        systems_count: members.length,
        systems: details,
        system_embedded_1: {
          status: embedded.status,
          error: embedded.json?.error || null,
          power: embedded.json?.PowerState || null,
        },
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
