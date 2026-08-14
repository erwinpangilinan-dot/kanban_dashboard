const net = require('net');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5000;
const REDFISH_PORT = 443;
const PING_TIMEOUT_MS = Number(process.env.NETWORK_PING_TIMEOUT_MS) || 5000;

function parsePingLatencyMs(output, isWin) {
  const text = String(output || '');
  if (isWin) {
    const avg = text.match(/Average\s*=\s*(\d+)\s*ms/i);
    if (avg) return Number(avg[1]);
    const time = text.match(/time[=<](\d+)\s*ms/i);
    if (time) return Number(time[1]);
    if (/time<1\s*ms/i.test(text)) return 0;
  } else {
    const time = text.match(/time[=<]([\d.]+)\s*ms/i);
    if (time) return Math.round(Number(time[1]));
  }
  return null;
}

function pingFailed(output) {
  return /100% packet loss|100% loss|timed out|unreachable|could not find host|general failure|destination host unreachable/i.test(
    String(output || '')
  );
}

/**
 * ICMP ping RTT (host-side poller; requires ping binary + raw socket privileges).
 */
async function measurePingLatency(host, timeoutMs = PING_TIMEOUT_MS) {
  const target = String(host || '').trim();
  if (!target) {
    return { reachable: false, latency_ms: null, error: 'No subcloud IP' };
  }

  const isWin = process.platform === 'win32';
  const args = isWin
    ? ['-n', '1', '-w', String(timeoutMs), target]
    : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), target];

  try {
    const { stdout, stderr } = await execFileAsync('ping', args, {
      timeout: timeoutMs + 3000,
      windowsHide: true,
    });
    const combined = `${stdout}\n${stderr}`;
    if (pingFailed(combined)) {
      return { reachable: false, latency_ms: null, error: 'Ping unreachable' };
    }
    const latency_ms = parsePingLatencyMs(combined, isWin);
    if (latency_ms != null) {
      return { reachable: true, latency_ms, error: null };
    }
    if (/reply from|bytes from/i.test(combined)) {
      return { reachable: true, latency_ms: null, error: null };
    }
    return { reachable: false, latency_ms: null, error: 'Ping failed' };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        reachable: false,
        latency_ms: null,
        error: 'ping command not available (use host poller or install iputils)',
      };
    }
    const combined = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`;
    if (pingFailed(combined)) {
      return { reachable: false, latency_ms: null, error: 'Ping unreachable' };
    }
    const latency_ms = parsePingLatencyMs(combined, isWin);
    if (latency_ms != null) {
      return { reachable: true, latency_ms, error: null };
    }
    return { reachable: false, latency_ms: null, error: err.message || 'Ping failed' };
  }
}

async function probeSubcloud(host) {
  return measurePingLatency(host);
}

/**
 * TCP connect RTT to BMC Redfish port (works for IPv4/IPv6).
 */
function measureTcpLatency(host, port = REDFISH_PORT, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      done({ reachable: true, latency_ms: Date.now() - start, error: null });
    });
    socket.once('timeout', () => {
      done({ reachable: false, latency_ms: null, error: `TCP timeout after ${timeoutMs}ms` });
    });
    socket.once('error', (err) => {
      done({ reachable: false, latency_ms: null, error: err.message });
    });

    try {
      socket.connect({ port, host });
    } catch (err) {
      done({ reachable: false, latency_ms: null, error: err.message });
    }
  });
}

const ALLOWED_RESET_TYPES = new Set([
  'GracefulRestart',
  'ForceRestart',
  'PowerCycle',
]);

const ALLOWED_BMC_RESET_TYPES = new Set(['GracefulRestart', 'ForceRestart']);

function httpsExchange(host, path, { method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const isV6 = host.includes(':');
  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  const agent = new https.Agent({ keepAlive: false, family: isV6 ? 6 : 4 });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: REDFISH_PORT,
        path,
        method,
        agent,
        headers: {
          Accept: 'application/json',
          Connection: 'close',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
        rejectUnauthorized: false,
        timeout: timeoutMs,
        family: isV6 ? 6 : undefined,
        servername: isV6 ? undefined : host,
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => { resBody += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: resBody });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Redfish timeout ${path}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJsonBody(res, path) {
  if (res.status >= 200 && res.status < 300) {
    if (!res.body) return {};
    try {
      return JSON.parse(res.body);
    } catch (err) {
      throw new Error(`Invalid JSON from Redfish ${path}: ${err.message}`);
    }
  }
  throw new Error(formatRedfishError(path, res.status, res.body));
}

function formatRedfishError(path, status, body) {
  const snippet = String(body || '').slice(0, 240);
  if (snippet.includes('UnauthorizedLoginAttempt')) {
    return 'Redfish login failed — check BMC username/password (HPE iLO)';
  }
  if (snippet.includes('NoValidSession')) {
    return 'Redfish auth failed — invalid or expired iLO session';
  }
  return `Redfish ${path} → HTTP ${status}: ${snippet}`;
}

function isAuthError(err) {
  const m = String(err?.message || '');
  return (
    m.includes('HTTP 401') ||
    m.includes('login failed') ||
    m.includes('UnauthorizedLoginAttempt') ||
    m.includes('NoValidSession')
  );
}

function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function normalizeRedfishPath(path) {
  if (!path || path === '/redfish/v1/') return path;
  return path.replace(/\/+$/, '');
}

async function createRedfishClient(host, { username, password, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!username || !password) {
    throw new Error('Redfish credentials not configured for this vendor');
  }

  const state = {
    host,
    username,
    password,
    timeoutMs,
    token: null,
    sessionPath: null,
    bmcVendor: null,
    product: null,
  };

  async function rawRequest(path, { method = 'GET', body = null, auth = 'auto' } = {}) {
    const headers = {};
    if (auth === 'session' && state.token) {
      headers['X-Auth-Token'] = state.token;
    } else if (auth !== 'none') {
      headers.Authorization = basicAuthHeader(state.username, state.password);
    }
    return httpsExchange(state.host, path, { method, headers, body, timeoutMs: state.timeoutMs });
  }

  async function jsonRequest(path, opts = {}) {
    const res = await rawRequest(path, opts);
    return parseJsonBody(res, path);
  }

  async function openIloSession() {
    const res = await rawRequest('/redfish/v1/SessionService/Sessions', {
      method: 'POST',
      body: { UserName: state.username, Password: state.password },
      auth: 'basic',
    });
    const token = res.headers['x-auth-token'];
    if (!token) {
      throw new Error(formatRedfishError('/redfish/v1/SessionService/Sessions', res.status, res.body));
    }
    state.token = token;
    state.sessionPath = res.headers.location || null;
  }

  async function close() {
    if (!state.token || !state.sessionPath) return;
    try {
      await rawRequest(state.sessionPath, { method: 'DELETE', auth: 'session' });
    } catch {
      // best-effort session cleanup
    }
    state.token = null;
    state.sessionPath = null;
  }

  async function init() {
    const root = await jsonRequest('/redfish/v1/');
    state.bmcVendor = String(root.Vendor || '').toUpperCase();
    state.product = root.Product || null;
    // HPE Edgeline e930t/iLO: Basic auth works; session POST can hang on some firmware.
    return root;
  }

  async function get(path) {
    return jsonRequest(normalizeRedfishPath(path), { auth: 'basic' });
  }

  async function post(path, body) {
    const normalized = normalizeRedfishPath(path);
    const res = await rawRequest(normalized, {
      method: 'POST',
      body,
      auth: 'basic',
    });
    if (res.status >= 200 && res.status < 300) {
      if (!res.body) return {};
      try {
        return JSON.parse(res.body);
      } catch {
        return {};
      }
    }
    throw new Error(formatRedfishError(normalized, res.status, res.body));
  }

  return { init, get, post, close, state };
}

/** Legacy Basic-auth helper (Dell reboot + backwards compat). */
function redfishRequest(
  host,
  path,
  { username, password, timeoutMs = DEFAULT_TIMEOUT_MS, method = 'GET', body } = {}
) {
  return new Promise((resolve, reject) => {
    httpsExchange(host, path, {
      method,
      headers: { Authorization: basicAuthHeader(username, password) },
      body,
      timeoutMs,
    })
      .then((res) => {
        try {
          resolve(parseJsonBody(res, path));
        } catch (err) {
          reject(err);
        }
      })
      .catch(reject);
  });
}

/**
 * Dell iDRAC: POST ComputerSystem.Reset (reboot host OS / system).
 */
async function rebootRedfishDell(
  host,
  { username, password, timeoutMs = 15_000, resetType = 'GracefulRestart' } = {}
) {
  if (!username || !password) {
    throw new Error('Redfish credentials not configured for this vendor');
  }
  if (!ALLOWED_RESET_TYPES.has(resetType)) {
    throw new Error(`Unsupported reset_type: ${resetType}`);
  }
  await redfishRequest(host, '/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset', {
    username,
    password,
    timeoutMs,
    method: 'POST',
    body: { ResetType: resetType },
  });
  return { reset_type: resetType, target: 'host', ok: true };
}

async function discoverManagerPaths(client, root) {
  const paths = [];
  const link = root?.Managers?.['@odata.id'];
  if (link) {
    try {
      const collection = await client.get(normalizeRedfishPath(link));
      for (const m of collection.Members || []) {
        const href = m['@odata.id'];
        if (href) paths.push(normalizeRedfishPath(href));
      }
    } catch {
      // fall through to static paths
    }
  }
  const bmcVendor = String(client.state?.bmcVendor || '').toUpperCase();
  if (bmcVendor.includes('HPE') || bmcVendor.includes('HP')) {
    paths.push('/redfish/v1/Managers/1');
  } else {
    paths.push(
      '/redfish/v1/Managers/iDRAC.Embedded.1',
      '/redfish/v1/Managers/1',
      '/redfish/v1/Managers/Self'
    );
  }
  return [...new Set(paths.map(normalizeRedfishPath))];
}

function managerHasResetAction(mgr) {
  return Boolean(mgr?.Actions?.['#Manager.Reset'] || mgr?.Actions?.['Manager.Reset']);
}

async function commandExists(name) {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    await execFileAsync(checker, [name]);
    return true;
  } catch {
    return false;
  }
}

async function commandExistsInWsl(name) {
  if (process.platform !== 'win32') return false;
  try {
    await execFileAsync('wsl', ['which', name], { windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveIpmitoolExec() {
  const custom = String(process.env.IPMITOOL_PATH || '').trim();
  if (custom) {
    const parts = custom.split(/\s+/).filter(Boolean);
    return { cmd: parts[0], prefixArgs: parts.slice(1) };
  }
  if (await commandExists('ipmitool')) {
    return { cmd: 'ipmitool', prefixArgs: [] };
  }
  if (process.platform === 'win32' && (await commandExists('wsl')) && (await commandExistsInWsl('ipmitool'))) {
    return { cmd: 'wsl', prefixArgs: ['ipmitool'] };
  }
  throw new Error(
    'ipmitool not found. Install ipmitool on the host poller (Windows: WSL apt install ipmitool, or set IPMITOOL_PATH).'
  );
}

function ipmitoolResetMode(resetType) {
  return resetType === 'ForceRestart' ? 'cold' : 'warm';
}

function isIpv6Host(host) {
  const trimmed = String(host || '').trim();
  return trimmed.includes(':') && !trimmed.startsWith('[');
}

/**
 * Reset ZT / IPMI BMC via ipmitool (mc reset warm|cold over lanplus).
 */
async function resetBmcIpmitool(
  host,
  { username, password, timeoutMs = 30_000, resetType = 'GracefulRestart' } = {}
) {
  if (!username || !password) {
    throw new Error('IPMI credentials not configured for this vendor');
  }
  if (!ALLOWED_BMC_RESET_TYPES.has(resetType)) {
    throw new Error(`Unsupported bmc reset_type: ${resetType}`);
  }

  const { cmd, prefixArgs } = await resolveIpmitoolExec();
  const mode = ipmitoolResetMode(resetType);
  const args = [...prefixArgs, '-I', 'lanplus'];
  if (isIpv6Host(host)) {
    args.push('-6');
  }
  args.push('-H', String(host).trim(), '-U', username, '-P', password, 'mc', 'reset', mode);

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    const output = `${stdout || ''}${stderr || ''}`.trim();
    return {
      reset_type: resetType,
      target: 'bmc',
      method: 'ipmitool',
      ipmitool_mode: mode,
      ok: true,
      output: output.slice(0, 200) || null,
    };
  } catch (err) {
    const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join(' ').trim();
    throw new Error(detail || 'ipmitool BMC reset failed');
  }
}

function isZtVendor(vendor) {
  return String(vendor || '').toUpperCase().includes('ZT');
}

/**
 * Reset the BMC itself (iDRAC / iLO / manager) via Redfish Manager.Reset.
 */
async function resetBmcRedfish(
  host,
  { username, password, timeoutMs = 15_000, resetType = 'GracefulRestart' } = {}
) {
  if (!username || !password) {
    throw new Error('Redfish credentials not configured for this vendor');
  }
  if (!ALLOWED_BMC_RESET_TYPES.has(resetType)) {
    throw new Error(`Unsupported bmc reset_type: ${resetType}`);
  }

  const client = await createRedfishClient(host, { username, password, timeoutMs });
  try {
    const root = await client.init();
    const managerPaths = await discoverManagerPaths(client, root);
    let lastErr = null;

    for (const mgrPath of managerPaths) {
      try {
        const mgr = await client.get(mgrPath);
        if (!managerHasResetAction(mgr)) continue;
        const actionPath = `${mgrPath}/Actions/Manager.Reset`;
        await client.post(actionPath, { ResetType: resetType });
        return { reset_type: resetType, target: 'bmc', manager: mgrPath, ok: true };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Redfish Manager.Reset action not found on this BMC');
  } finally {
    await client.close();
  }
}

function pickHealth(status) {
  if (!status) return null;
  return status.Health || status.HealthRollup || null;
}

function pickSystemModel(system) {
  const model = String(system.Model || '').trim();
  if (model) return model;
  const sku = String(system.SKU || system.PartNumber || '').trim();
  const mfr = String(system.Manufacturer || '').trim();
  if (mfr && sku) return `${mfr} ${sku}`;
  if (sku) return sku;
  if (mfr) return mfr;
  return null;
}

function normalizeSystemHealth(system, storageRollup, powerSupplyRollup = null, sessionRollup = null) {
  const proc = system.ProcessorSummary || {};
  const mem = system.MemorySummary || {};
  const psu = powerSupplyRollup || {};
  const sessions = sessionRollup || { count: null, max: null, users: [] };
  return {
    system: {
      health: pickHealth(system.Status) || 'Unknown',
      power: system.PowerState || null,
      model: pickSystemModel(system),
      serial: system.SerialNumber || null,
    },
    processor: {
      health: pickHealth(proc.Status) || pickHealth(system.Status) || 'Unknown',
      count: proc.Count ?? null,
      model: proc.Model || null,
    },
    memory: {
      health: pickHealth(mem.Status) || 'Unknown',
      size_gib: mem.TotalSystemMemoryGiB ?? null,
    },
    storage: {
      health: storageRollup || 'Unknown',
    },
    power_supply: {
      health: psu.health || 'Unknown',
      count: psu.count ?? null,
      ok_count: psu.ok_count ?? null,
      supplies: psu.supplies || [],
    },
    sessions: {
      count: sessions.count ?? null,
      max: sessions.max ?? null,
      users: sessions.users || [],
    },
  };
}

function pickHpeAggregateStorageHealth(system) {
  const storage = system?.Oem?.Hpe?.AggregateHealthStatus?.Storage?.Status;
  return pickHealth(storage) || null;
}

async function rollupStorageHealthClient(client, systemPath, systemObj = null) {
  const storageRoots = [];
  if (systemObj?.Storage?.['@odata.id']) {
    storageRoots.push(normalizeRedfishPath(systemObj.Storage['@odata.id']));
  }
  storageRoots.push(`${systemPath}/Storage`, `${systemPath}/SimpleStorage`);
  const rank = { OK: 0, Warning: 1, Critical: 2 };
  let worst = null;

  for (const rootPath of [...new Set(storageRoots.map(normalizeRedfishPath))]) {
    try {
      const storageRoot = await client.get(rootPath);
      const members = storageRoot.Members || [];
      if (!members.length) continue;

      for (const m of members.slice(0, 12)) {
        const href = m['@odata.id'];
        if (!href) continue;
        try {
          const ctrl = await client.get(href);
          const h = pickHealth(ctrl.Status) || 'OK';
          if (worst == null || (rank[h] ?? 0) > (rank[worst] ?? 0)) worst = h;
        } catch {
          // skip individual member errors
        }
      }
      if (worst) return worst;
      if (members.length) return 'OK';
    } catch {
      // try next storage collection
    }
  }

  const hpeAgg = systemObj ? pickHpeAggregateStorageHealth(systemObj) : null;
  if (hpeAgg) return hpeAgg;

  return worst || 'Unknown';
}

const HEALTH_RANK = { OK: 0, Warning: 1, Critical: 2 };

function worstHealth(a, b) {
  const ra = HEALTH_RANK[a] ?? -1;
  const rb = HEALTH_RANK[b] ?? -1;
  if (ra >= rb) return a || b;
  return b || a;
}

function normalizePowerSupplyEntry(psu) {
  return {
    name: psu.Name || psu.MemberId || psu.Id || 'PSU',
    health: pickHealth(psu.Status) || 'Unknown',
    state: psu.Status?.State || null,
    watts: psu.PowerCapacityWatts ?? psu.LastPowerOutputWatts ?? null,
  };
}

async function fetchPowerSuppliesFromPowerResource(client, power) {
  const supplies = [];
  if (Array.isArray(power?.PowerSupplies)) {
    for (const psu of power.PowerSupplies) {
      if (psu && typeof psu === 'object') supplies.push(normalizePowerSupplyEntry(psu));
    }
  }
  const collLink = power?.PowerSupplies?.['@odata.id'];
  if (collLink) {
    try {
      const coll = await client.get(normalizeRedfishPath(collLink));
      for (const m of coll.Members || []) {
        const href = m['@odata.id'];
        if (!href) continue;
        try {
          supplies.push(normalizePowerSupplyEntry(await client.get(href)));
        } catch {
          // skip individual PSU
        }
      }
    } catch {
      // collection unavailable
    }
  }
  return supplies;
}

async function discoverChassisPaths(client, root) {
  const paths = [];
  const chassisLink = root?.Chassis?.['@odata.id'];
  if (chassisLink) {
    try {
      const collection = await client.get(normalizeRedfishPath(chassisLink));
      for (const m of collection.Members || []) {
        const href = m['@odata.id'];
        if (href) paths.push(normalizeRedfishPath(href));
      }
    } catch {
      // fall through to static paths
    }
  }
  const bmcVendor = String(client.state?.bmcVendor || '').toUpperCase();
  if (bmcVendor.includes('HPE') || bmcVendor.includes('HP')) {
    paths.push('/redfish/v1/Chassis/1');
  } else {
    paths.push(
      '/redfish/v1/Chassis/System.Embedded.1',
      '/redfish/v1/Chassis/Self',
      '/redfish/v1/Chassis/1'
    );
  }
  return [...new Set(paths.map(normalizeRedfishPath))];
}

async function rollupPowerSupplyHealthClient(client, root) {
  const chassisPaths = await discoverChassisPaths(client, root);
  for (const chassisPath of chassisPaths) {
    try {
      const supplies = await fetchPowerSuppliesFromPowerResource(
        client,
        await client.get(`${chassisPath}/Power`)
      );
      if (!supplies.length) continue;
      let worst = 'OK';
      let okCount = 0;
      for (const psu of supplies) {
        if (psu.health === 'OK') okCount += 1;
        worst = worstHealth(worst, psu.health);
      }
      return {
        health: worst,
        count: supplies.length,
        ok_count: okCount,
        supplies: supplies.slice(0, 8),
      };
    } catch {
      // try next chassis
    }
  }
  return { health: 'Unknown', count: 0, ok_count: 0, supplies: [] };
}

function pickSessionServiceMax(sessionService) {
  if (!sessionService) return null;
  return (
    sessionService.MaxConcurrentSessions ??
    sessionService.ServiceEnabledCount ??
    sessionService.Oem?.Dell?.MaxConcurrentSessions ??
    null
  );
}

async function enrichSessionUsers(client, members) {
  const users = [];
  for (const m of members.slice(0, 8)) {
    const href = m?.['@odata.id'];
    if (!href) continue;
    try {
      const sess = await client.get(href);
      const user = sess.UserName || sess.Name || sess.Id;
      if (user) users.push(String(user));
    } catch {
      // skip individual session
    }
  }
  return users;
}

/**
 * Active Redfish / BMC user sessions (SessionService/Sessions collection).
 */
async function rollupBmcSessionCount(client, root) {
  const sessionCollectionPaths = [];
  let maxSessions = null;

  const ssLink = root?.SessionService?.['@odata.id'];
  if (ssLink) {
    try {
      const sessionService = await client.get(normalizeRedfishPath(ssLink));
      maxSessions = pickSessionServiceMax(sessionService);
      if (typeof sessionService.SessionCount === 'number') {
        return {
          count: sessionService.SessionCount,
          max: maxSessions,
          users: [],
        };
      }
      const sessionsLink = sessionService.Sessions?.['@odata.id'];
      if (sessionsLink) sessionCollectionPaths.push(normalizeRedfishPath(sessionsLink));
    } catch {
      // fall through
    }
  }

  sessionCollectionPaths.push('/redfish/v1/SessionService/Sessions');

  const managerPaths = await discoverManagerPaths(client, root);
  for (const mgrPath of managerPaths) {
    try {
      const mgr = await client.get(mgrPath);
      const sessionsLink =
        mgr.Links?.Sessions?.['@odata.id'] || mgr.Sessions?.['@odata.id'];
      if (sessionsLink) sessionCollectionPaths.push(normalizeRedfishPath(sessionsLink));
    } catch {
      // try next manager
    }
  }

  for (const collPath of [...new Set(sessionCollectionPaths.map(normalizeRedfishPath))]) {
    try {
      const coll = await client.get(collPath);
      if (maxSessions == null) {
        maxSessions = pickSessionServiceMax(coll);
      }
      if (typeof coll['@odata.count'] === 'number') {
        const users = await enrichSessionUsers(client, coll.Members || []);
        return { count: coll['@odata.count'], max: maxSessions, users };
      }
      const members = coll.Members || [];
      const users = await enrichSessionUsers(client, members);
      return { count: members.length, max: maxSessions, users };
    } catch {
      // try next collection path
    }
  }

  return { count: null, max: maxSessions, users: [] };
}

async function discoverSystemPaths(client, root) {
  const paths = [];
  const systemsLink = root.Systems?.['@odata.id'];
  if (systemsLink) {
    const link = normalizeRedfishPath(systemsLink);
    try {
      const collection = await client.get(link);
      for (const m of collection.Members || []) {
        const href = m['@odata.id'];
        if (href) paths.push(normalizeRedfishPath(href));
      }
    } catch {
      // fall through to static paths
    }
  }

  const bmcVendor = String(client.state.bmcVendor || '').toUpperCase();
  if (bmcVendor.includes('HPE') || bmcVendor.includes('HP')) {
    paths.push('/redfish/v1/Systems/1');
  } else {
    paths.push('/redfish/v1/Systems/Self', '/redfish/v1/Systems/1');
  }

  return [...new Set(paths)];
}

async function probeRedfishWithClient(host, creds) {
  const client = await createRedfishClient(host, creds);
  try {
    const root = await client.init();
    const systemPaths = await discoverSystemPaths(client, root);
    let lastErr = null;

    for (const path of systemPaths) {
      try {
        const system = await client.get(path);
        const storageHealth = await rollupStorageHealthClient(client, path, system);
        const powerSupplyRollup = await rollupPowerSupplyHealthClient(client, root);
        const sessionRollup = await rollupBmcSessionCount(client, root);
        return normalizeSystemHealth(system, storageHealth, powerSupplyRollup, sessionRollup);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Redfish system resource not found');
  } finally {
    await client.close();
  }
}

async function probeRedfishDell(host, { username, password, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!username || !password) {
    throw new Error('Redfish credentials not configured for this vendor');
  }
  const creds = { username, password, timeoutMs };
  const root = await redfishRequest(host, '/redfish/v1/', creds);
  const system = await redfishRequest(host, '/redfish/v1/Systems/System.Embedded.1', creds);
  const client = {
    get: (path) => redfishRequest(host, path, creds),
    state: { bmcVendor: String(root.Vendor || 'DELL').toUpperCase() },
  };
  const storageHealth = await rollupStorageHealthClient(
    client,
    '/redfish/v1/Systems/System.Embedded.1'
  );
  const powerSupplyRollup = await rollupPowerSupplyHealthClient(client, root);
  const sessionRollup = await rollupBmcSessionCount(client, root);
  return normalizeSystemHealth(system, storageHealth, powerSupplyRollup, sessionRollup);
}

async function probeRedfishGeneric(host, creds) {
  return probeRedfishWithClient(host, creds);
}

function redfishProbeForVendor(vendor) {
  const v = String(vendor || '').toUpperCase();
  if (v.includes('DELL') || v.includes('IDRAC')) return 'dell';
  if (v.includes('HPE') || v.includes('HP') || v.includes('ILO')) return 'generic';
  return 'generic';
}

async function probeDevice(host, vendorCreds, vendor, { altCredsList = [] } = {}) {
  const connectivity = await measureTcpLatency(host);
  if (!connectivity.reachable) {
    return {
      reachable: false,
      latency_ms: null,
      redfish_ok: false,
      health: {},
      error: connectivity.error || 'Unreachable',
    };
  }

  const credSets = [vendorCreds];
  for (const alt of altCredsList) {
    if (alt?.username && alt?.password) credSets.push(alt);
  }

  const probeKind = redfishProbeForVendor(vendor);
  let lastErr = null;

  for (const creds of credSets) {
    if (!creds?.username || !creds?.password) continue;
    try {
      const health =
        probeKind === 'dell'
          ? await probeRedfishDell(host, creds)
          : await probeRedfishGeneric(host, creds);
      return {
        reachable: true,
        latency_ms: connectivity.latency_ms,
        redfish_ok: true,
        health,
        error: null,
      };
    } catch (err) {
      lastErr = err;
      if (!isAuthError(err)) break;
    }
  }

  return {
    reachable: true,
    latency_ms: connectivity.latency_ms,
    redfish_ok: false,
    health: {},
    error: lastErr?.message || 'Redfish probe failed',
  };
}

module.exports = {
  measureTcpLatency,
  measurePingLatency,
  probeSubcloud,
  probeRedfishDell,
  probeRedfishGeneric,
  redfishProbeForVendor,
  probeDevice,
  rebootRedfishDell,
  resetBmcRedfish,
  resetBmcIpmitool,
  isZtVendor,
  ALLOWED_BMC_RESET_TYPES,
  ALLOWED_RESET_TYPES,
  REDFISH_PORT,
  isAuthError,
};
