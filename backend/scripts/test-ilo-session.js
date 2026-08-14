require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const https = require('https');
const { getVendorCredentials } = require('../src/services/network-credentials');

function request(host, path, { method = 'GET', headers = {}, body = null, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
        rejectUnauthorized: false,
        timeout: timeoutMs,
        family: 6,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function iloSession(host, username, password) {
  const res = await request(host, '/redfish/v1/SessionService/Sessions', {
    method: 'POST',
    headers: {},
    body: { UserName: username, Password: password },
  });
  const token = res.headers['x-auth-token'];
  const loc = res.headers.location;
  console.log('Session POST →', res.status, 'token:', Boolean(token), 'location:', loc || '(none)');
  if (!token) {
    console.log('body:', res.body.slice(0, 200));
    return null;
  }
  return { token, location: loc };
}

async function main() {
  const host = process.argv[2];
  const creds = await getVendorCredentials('ZT');
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const session = await iloSession(host, creds.username, creds.password);
  if (!session) return;

  for (const p of ['/redfish/v1/Systems', '/redfish/v1/Systems/1']) {
    const res = await request(host, p, {
      headers: { 'X-Auth-Token': session.token },
    });
    console.log(`GET ${p} (session) →`, res.status, res.body.slice(0, 200).replace(/\s+/g, ' '));
  }

  if (session.location) {
    await request(host, session.location, { method: 'DELETE', headers: { 'X-Auth-Token': session.token } });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
