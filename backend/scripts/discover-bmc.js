require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const https = require('https');
const { getVendorCredentials } = require('../src/services/network-credentials');

const host = process.argv[2];
const vendor = process.argv[3] || 'ZT';

function rfGet(host, path, auth) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        rejectUnauthorized: false,
        timeout: 10000,
        family: 6,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function probe(path, auth) {
  try {
    const { status, body } = await rfGet(host, path, auth);
    let note = body.slice(0, 180).replace(/\s+/g, ' ');
    try {
      const j = JSON.parse(body);
      if (j.Members) note = `Members: ${j.Members.map((m) => m['@odata.id']).join(', ')}`;
      else if (j.Status?.Health) note = `Health=${j.Status.Health} Power=${j.PowerState || '?'}`;
      else if (j['@odata.type']) note = `type=${j['@odata.type']}`;
      else if (j.error?.code) note = `error=${j.error.code}`;
    } catch { /* raw */ }
    return `${status} ${note}`;
  } catch (err) {
    return `ERR ${err.message}`;
  }
}

async function main() {
  if (!host) {
    console.error('Usage: node discover-bmc.js <bmc_ip> [vendor]');
    process.exit(1);
  }
  const creds = await getVendorCredentials(vendor);
  console.log('Vendor', vendor, 'configured:', creds.configured);
  const auth = creds.configured
    ? Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
    : null;

  const paths = [
    '/redfish/v1/',
    '/redfish/v1/Systems',
    '/redfish/v1/Systems/Self',
    '/redfish/v1/Systems/1',
    '/redfish/v1/Systems/System.Embedded.1',
    '/redfish/v1/Managers/1',
    '/redfish/v1/Managers/Self',
  ];

  for (const p of paths) {
    console.log(p, '→', auth ? await probe(p, auth) : 'no creds');
  }

  if (creds.configured) {
    const hpe = await getVendorCredentials('HPE');
    if (hpe.configured && hpe.username !== creds.username) {
      console.log('\n--- retry with HPE creds ---');
      const hpeAuth = Buffer.from(`${hpe.username}:${hpe.password}`).toString('base64');
      for (const p of ['/redfish/v1/Systems', '/redfish/v1/Systems/1', '/redfish/v1/Managers/1']) {
        console.log(p, '→', await probe(p, hpeAuth));
      }
    } else {
      console.log('\n(HPE creds not configured separately)');
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
