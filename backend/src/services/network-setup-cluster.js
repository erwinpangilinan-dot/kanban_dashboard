const https = require('https');
const { URL } = require('url');
const {
  middlewareCredentialsConfigured,
  middlewarePassword,
  shouldUseHostMiddleware,
  isHostAgentUnreachable,
} = require('./network-subcloud-middleware');
const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');
const { orchestrationOrigin, connectionDetailsSettingsPublic } = require('./network-connection-details');

function setupClusterUrl(clusterName) {
  const name = String(clusterName || '').trim();
  if (!name) throw new Error('cluster_name is required');
  const encoded = encodeURIComponent(name);
  return `${orchestrationOrigin()}/orchestration/setup-cluster/${encoded}`;
}

function basicAuthHeader() {
  const username = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME?.trim();
  const password = middlewarePassword();
  if (!username || !password) {
    throw new Error(
      'Middleware credentials not configured (set NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME/PASSWORD in .env)'
    );
  }
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function httpsRequest(url, { method = 'POST', headers = {}, body = null, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl, redirectsLeft) => {
      const u = new URL(targetUrl);
      const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
      const reqHeaders = { ...headers };
      if (payload && !reqHeaders['Content-Length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = https.request(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          method,
          headers: reqHeaders,
          rejectUnauthorized: false,
        },
        (res) => {
          const status = res.statusCode || 0;
          const location = res.headers.location;
          if (
            redirectsLeft > 0 &&
            location &&
            [301, 302, 303, 307, 308].includes(status)
          ) {
            res.resume();
            const next = new URL(location, targetUrl).toString();
            follow(next, redirectsLeft - 1);
            return;
          }
          let responseBody = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            responseBody += chunk;
            if (responseBody.length > 2_000_000) {
              reject(new Error('Setup cluster response too large'));
              req.destroy();
            }
          });
          res.on('end', () => {
            resolve({ status, headers: res.headers, body: responseBody });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    };
    follow(url, maxRedirects);
  });
}

function parseResponseBody(body, contentType) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return null;
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: trimmed };
    }
  }
  return { raw: trimmed };
}

async function triggerSetupClusterDirect(clusterName) {
  if (!middlewareCredentialsConfigured()) {
    throw new Error(
      'Middleware credentials not configured (set NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME/PASSWORD in .env)'
    );
  }
  const url = setupClusterUrl(clusterName);
  const res = await httpsRequest(url, {
    method: 'GET',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json, text/plain, */*',
    },
    body: null,
  });
  if (res.status >= 400) {
    const snippet = String(res.body || '')
      .replace(/\s+/g, ' ')
      .slice(0, 240);
    throw new Error(`Middleware HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
  }
  const contentType = res.headers['content-type'];
  return {
    cluster_name: String(clusterName).trim(),
    url,
    data: parseResponseBody(res.body, contentType),
    triggered_at: new Date().toISOString(),
    via: 'direct',
  };
}

async function triggerSetupClusterViaHostAgent(clusterName) {
  const base = hostAgentBaseUrl();
  const url = `${base}/middleware/setup-cluster?cluster_name=${encodeURIComponent(String(clusterName).trim())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: hostAgentHeaders(),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Host setup-cluster proxy failed (${res.status})`);
    }
    return { ...body, via: 'host-agent' };
  } finally {
    clearTimeout(timer);
  }
}

async function triggerSetupClusterForCluster(clusterName) {
  if (shouldUseHostMiddleware()) {
    try {
      return await triggerSetupClusterViaHostAgent(clusterName);
    } catch (err) {
      const msg = String(err?.message || '');
      const hostRouteMissing = /404|Not found|proxy failed \(404\)/i.test(msg);
      if (!isHostAgentUnreachable(err) && !hostRouteMissing) {
        throw err;
      }
    }
  }
  try {
    return await triggerSetupClusterDirect(clusterName);
  } catch (err) {
    if (isHostAgentUnreachable(err)) {
      return triggerSetupClusterViaHostAgent(clusterName);
    }
    throw err;
  }
}

async function triggerSetupClusterForDevice(device) {
  const clusterName = device?.cluster_name?.trim();
  if (!clusterName) {
    const err = new Error(
      `Missing cluster name for gNB DUID ${device?.cluster_id || device?.id || 'unknown'} — run Sync from Drive or middleware enrich`
    );
    err.status = 400;
    throw err;
  }
  const result = await triggerSetupClusterForCluster(clusterName);
  return {
    device_id: device.id,
    cluster_id: device.cluster_id,
    ...result,
  };
}

function setupClusterSettingsPublic() {
  return connectionDetailsSettingsPublic();
}

module.exports = {
  setupClusterUrl,
  triggerSetupClusterDirect,
  triggerSetupClusterViaHostAgent,
  triggerSetupClusterForCluster,
  triggerSetupClusterForDevice,
  setupClusterSettingsPublic,
};
