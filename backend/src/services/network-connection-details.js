const https = require('https');
const { URL } = require('url');
const {
  middlewareCredentialsConfigured,
  middlewarePassword,
  shouldUseHostMiddleware,
  isHostAgentUnreachable,
} = require('./network-subcloud-middleware');
const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');

function orchestrationOrigin() {
  const raw =
    process.env.NETWORK_ORCHESTRATION_BASE_URL?.trim() ||
    process.env.NETWORK_SUBCLOUD_MIDDLEWARE_URL?.trim() ||
    'https://middleware.faredge.vzwops.com/caas/subcloud/';
  try {
    return new URL(raw).origin;
  } catch {
    return 'https://middleware.faredge.vzwops.com';
  }
}

function connectionDetailsUrl(clusterName) {
  const name = String(clusterName || '').trim();
  if (!name) throw new Error('cluster_name is required');
  const encoded = encodeURIComponent(name);
  return `${orchestrationOrigin()}/orchestration/remote-regions/${encoded}/connection-details?team=orchestration`;
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

function httpsRequest(url, { method = 'GET', headers = {}, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl, redirectsLeft) => {
      const u = new URL(targetUrl);
      const req = https.request(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          method,
          headers,
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
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
            if (body.length > 2_000_000) {
              reject(new Error('Connection details response too large'));
              req.destroy();
            }
          });
          res.on('end', () => {
            resolve({ status, headers: res.headers, body });
          });
        }
      );
      req.on('error', reject);
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

async function fetchConnectionDetailsDirect(clusterName) {
  if (!middlewareCredentialsConfigured()) {
    throw new Error(
      'Middleware credentials not configured (set NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME/PASSWORD in .env)'
    );
  }
  const url = connectionDetailsUrl(clusterName);
  const res = await httpsRequest(url, {
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json, text/plain, */*',
    },
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
    fetched_at: new Date().toISOString(),
    via: 'direct',
  };
}

async function fetchConnectionDetailsViaHostAgent(clusterName) {
  const base = hostAgentBaseUrl();
  const url = `${base}/middleware/connection-details?cluster_name=${encodeURIComponent(String(clusterName).trim())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, { headers: hostAgentHeaders(), signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Host connection-details proxy failed (${res.status})`);
    }
    return { ...body, via: 'host-agent' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchConnectionDetailsForCluster(clusterName) {
  if (shouldUseHostMiddleware()) {
    return fetchConnectionDetailsViaHostAgent(clusterName);
  }
  try {
    return await fetchConnectionDetailsDirect(clusterName);
  } catch (err) {
    if (isHostAgentUnreachable(err)) {
      return fetchConnectionDetailsViaHostAgent(clusterName);
    }
    throw err;
  }
}

async function fetchConnectionDetailsForDevice(device) {
  const clusterName = device?.cluster_name?.trim();
  if (!clusterName) {
    const err = new Error(
      `Missing cluster name for gNB DUID ${device?.cluster_id || device?.id || 'unknown'} — run Sync from Drive or middleware enrich`
    );
    err.status = 400;
    throw err;
  }
  const result = await fetchConnectionDetailsForCluster(clusterName);
  return {
    device_id: device.id,
    cluster_id: device.cluster_id,
    ...result,
  };
}

function connectionDetailsSettingsPublic() {
  return {
    configured: middlewareCredentialsConfigured(),
    via_host: shouldUseHostMiddleware(),
  };
}

module.exports = {
  orchestrationOrigin,
  connectionDetailsUrl,
  fetchConnectionDetailsDirect,
  fetchConnectionDetailsViaHostAgent,
  fetchConnectionDetailsForCluster,
  fetchConnectionDetailsForDevice,
  connectionDetailsSettingsPublic,
};
