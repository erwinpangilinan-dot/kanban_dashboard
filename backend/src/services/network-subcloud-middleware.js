const DEFAULT_URL = 'https://middleware.faredge.vzwops.com/caas/subcloud/';

function middlewareUrl() {
  return (process.env.NETWORK_SUBCLOUD_MIDDLEWARE_URL || DEFAULT_URL).replace(/\/?$/, '/');
}

const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');

function middlewareEnabled() {
  const v = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_ENABLED;
  if (v === '0' || v === 'false') return false;
  return true;
}

function shouldUseHostMiddleware() {
  return (
    process.env.NETWORK_SUBCLOUD_MIDDLEWARE_VIA_HOST === '1' ||
    process.env.NETWORK_SUBCLOUD_MIDDLEWARE_VIA_HOST === 'true' ||
    process.env.NETWORK_SKIP_CONTAINER_POLLER === '1' ||
    process.env.NETWORK_SKIP_CONTAINER_POLLER === 'true'
  );
}

function isHostAgentUnreachable(err) {
  const msg = String(err?.message || err?.cause?.message || '');
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ECONNABORTED|socket hang up|bad address/i.test(
    msg
  );
}

function middlewarePassword() {
  const raw = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD ?? '';
  // Docker env_file expands $$ → $; Node dotenv leaves $$ literal — normalize both.
  return raw.replace(/\$\$/g, '$');
}

function middlewareCredentialsConfigured() {
  return Boolean(
    process.env.NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME?.trim() && middlewarePassword()
  );
}

function mergeCookieHeader(existing, setCookieHeader) {
  const jar = new Map();
  for (const part of String(existing || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  const chunks = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : String(setCookieHeader || '')
        .split(/,(?=[^;,]+?=)/)
        .map((s) => s.trim())
        .filter(Boolean);
  for (const chunk of chunks) {
    const pair = chunk.split(';')[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function collectSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function cleanValue(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v === 'None' || v === 'null') return null;
  return v;
}

function parsePreBlock(text) {
  const record = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([a-z0-9_]+):\s*(.*)$/i);
    if (!m) continue;
    record[m[1].toLowerCase()] = cleanValue(m[2]);
  }
  return record;
}

function parseMiddlewareHtml(html) {
  const records = [];
  const re = /<pre>([\s\S]*?)<\/pre>/gi;
  let match;
  while ((match = re.exec(html))) {
    const block = parsePreBlock(match[1]);
    if (Object.keys(block).length) records.push(block);
  }
  return records;
}

function extractGnbDuid(record) {
  for (const key of ['namespace_label', 'namespace_name']) {
    const text = record[key] || '';
    const tail = text.match(/(\d{11})\s*$/);
    if (tail) return tail[1];
    const any = text.match(/\b(299\d{8}|299\d{7,})\b/);
    if (any) return any[1];
  }
  return null;
}

function indexRecordsByGnbDuid(records) {
  const byDuid = new Map();
  for (const record of records) {
    const duid = extractGnbDuid(record);
    if (duid) byDuid.set(duid, record);
  }
  return byDuid;
}

/**
 * Fuze SiteID → subcloud records.
 * /caas/subcloud/ is reachable with CSRF cookie only — no AD login.
 * (Connection-details / setup-cluster still use Basic auth separately.)
 */
async function fetchSubcloudRecordsDirect(fuzeSiteId) {
  const base = middlewareUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const get = await fetch(base, { signal: controller.signal });
    const cookies = mergeCookieHeader('', collectSetCookies(get));
    const html = await get.text();
    if (/<title>VCPFE Middleware Login<\/title>/i.test(html)) {
      throw new Error(
        'Middleware subcloud page requires login unexpectedly (was previously anonymous)'
      );
    }
    const csrf = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
    const body = new URLSearchParams({ fuze_id: String(fuzeSiteId).trim() });
    if (csrf) body.set('csrfmiddlewaretoken', csrf[1]);
    const post = await fetch(base, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookies ? { Cookie: cookies } : {}),
        Referer: base,
      },
      body: body.toString(),
    });
    if (!post.ok) {
      throw new Error(`Middleware HTTP ${post.status} for Fuze SiteID ${fuzeSiteId}`);
    }
    const out = await post.text();
    if (/<title>VCPFE Middleware Login<\/title>/i.test(out)) {
      throw new Error(
        'Middleware subcloud page requires login unexpectedly (was previously anonymous)'
      );
    }
    return parseMiddlewareHtml(out);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSubcloudRecordsViaHostAgent(fuzeSiteId) {
  const base = hostAgentBaseUrl();
  const url = `${base}/middleware/subcloud?fuze_site_id=${encodeURIComponent(String(fuzeSiteId).trim())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, { headers: hostAgentHeaders(), signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Host middleware proxy failed (${res.status})`);
    }
    return body.records || [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSubcloudRecordsForFuzeSite(fuzeSiteId) {
  if (shouldUseHostMiddleware()) {
    return fetchSubcloudRecordsViaHostAgent(fuzeSiteId);
  }
  try {
    return await fetchSubcloudRecordsDirect(fuzeSiteId);
  } catch (err) {
    if (isHostAgentUnreachable(err)) {
      return fetchSubcloudRecordsViaHostAgent(fuzeSiteId);
    }
    throw err;
  }
}

function pickClusterNamespace(record) {
  const name = record.namespace_name?.trim();
  if (name) return name;
  return record.namespace_label?.trim() || null;
}

function applyMiddlewareRecord(device, record) {
  const updates = {};
  const subcloudIp = record.oam_vip_address;
  const clusterName = record.cluster_name;
  const clusterNamespace = pickClusterNamespace(record);
  const parentController = record.parent_cluster_name;
  const bmcIp = record.ilo_host_address;
  const oamIp = record.oam_host_address;

  if (subcloudIp && subcloudIp !== device.subcloud_ip) {
    updates.subcloud_ip = subcloudIp;
  }
  if (clusterName && clusterName !== device.cluster_name) {
    updates.cluster_name = clusterName;
  }
  if (clusterNamespace && clusterNamespace !== device.cluster_namespace) {
    updates.cluster_namespace = clusterNamespace;
  }
  if (parentController && parentController !== device.parent_controller) {
    updates.parent_controller = parentController;
  }
  if (bmcIp && bmcIp !== device.bmc_ip) {
    updates.bmc_ip = bmcIp;
  }
  if (oamIp && oamIp !== device.oam_ip) {
    updates.oam_ip = oamIp;
  }
  return updates;
}

async function enrichDevicesFromMiddleware(devices) {
  if (!middlewareEnabled()) {
    return { enabled: false, sites: 0, matched: 0, updated: 0, errors: [] };
  }

  const withSite = devices.filter((d) => d.fuze_site_id?.trim());
  const siteIds = [...new Set(withSite.map((d) => d.fuze_site_id.trim()))];
  const errors = [];
  let matched = 0;
  let updated = 0;

  for (const siteId of siteIds) {
    try {
      const records = await fetchSubcloudRecordsForFuzeSite(siteId);
      const byDuid = indexRecordsByGnbDuid(records);
      for (const device of withSite.filter((d) => d.fuze_site_id.trim() === siteId)) {
        const record = byDuid.get(device.cluster_id);
        if (!record) continue;
        matched += 1;
        const patch = applyMiddlewareRecord(device, record);
        if (Object.keys(patch).length) {
          Object.assign(device, patch);
          updated += 1;
        }
      }
    } catch (err) {
      errors.push({ fuze_site_id: siteId, error: err.message || String(err) });
    }
  }

  return {
    enabled: true,
    url: middlewareUrl(),
    sites: siteIds.length,
    matched,
    updated,
    errors,
  };
}

module.exports = {
  middlewareUrl,
  middlewareEnabled,
  middlewareCredentialsConfigured,
  middlewarePassword,
  shouldUseHostMiddleware,
  hostAgentBaseUrl,
  isHostAgentUnreachable,
  parsePreBlock,
  parseMiddlewareHtml,
  extractGnbDuid,
  indexRecordsByGnbDuid,
  fetchSubcloudRecordsDirect,
  fetchSubcloudRecordsViaHostAgent,
  fetchSubcloudRecordsForFuzeSite,
  enrichDevicesFromMiddleware,
  applyMiddlewareRecord,
  pickClusterNamespace,
};
