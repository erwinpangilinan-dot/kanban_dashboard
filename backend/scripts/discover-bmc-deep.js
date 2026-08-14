require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const https = require('https');
const { getVendorCredentials } = require('../src/services/network-credentials');

const host = process.argv[2];
const vendorArg = process.argv[3] || 'ZT';

function request(host, path, { auth, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = `Basic ${auth}`;
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method,
        headers,
        rejectUnauthorized: false,
        timeout: 12000,
        family: 6,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function tryVendor(vendor) {
  const creds = await getVendorCredentials(vendor);
  console.log(`\n=== ${vendor} configured=${creds.configured} user=${creds.username || '(empty)'} ===`);
  if (!creds.configured) return;
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');

  const root = await request(host, '/redfish/v1/', { auth });
  console.log('GET /redfish/v1/ →', root.status);
  if (root.status === 200) {
    const j = JSON.parse(root.body);
    console.log('  Vendor:', j.Vendor, 'Product:', j.Product, 'UUID:', j.UUID?.slice?.(0, 8));
    console.log('  Systems link:', j.Systems?.['@odata.id']);
    console.log('  Managers link:', j.Managers?.['@odata.id']);
    const systemsPath = j.Systems?.['@odata.id'];
    const pathsToTry = [
      systemsPath,
      systemsPath?.replace(/\/$/, ''),
      '/redfish/v1/Systems/1',
      '/redfish/v1/Systems/1/',
    ].filter(Boolean);
    for (const p of pathsToTry) {
      try {
        const sysCol = await request(host, p, { auth });
        console.log(`GET ${p} →`, sysCol.status);
        if (sysCol.status === 200) {
          const sc = JSON.parse(sysCol.body);
          if (sc.Members) {
            console.log('  Members:', (sc.Members || []).map((m) => m['@odata.id']).join(', '));
          } else if (sc.Status) {
            console.log('  Health:', sc.Status?.Health, 'Power:', sc.PowerState, 'Model:', sc.Model);
          }
        } else {
          console.log('  body:', sysCol.body.slice(0, 160));
        }
      } catch (err) {
        console.log(`GET ${p} → ERR`, err.message);
      }
    }
  } else {
    console.log('  body:', root.body.slice(0, 200));
  }
}

async function main() {
  if (!host) {
    console.error('Usage: node discover-bmc-deep.js <bmc_ip> [vendor]');
    process.exit(1);
  }
  console.log('Host:', host);
  const anon = await request(host, '/redfish/v1/');
  console.log('Anonymous /redfish/v1/ →', anon.status, anon.body.slice(0, 120));

  await tryVendor(vendorArg);
  await tryVendor('HPE');
}

main().catch((e) => { console.error(e); process.exit(1); });
