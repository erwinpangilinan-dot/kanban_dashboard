/**
 * Host-side network poller for environments where the API container cannot
 * reach BMC IPv6 (typical Docker Desktop / WSL2). Writes the same snapshots
 * the in-container poller would.
 *
 * Also exposes a tiny localhost agent for reboot actions so the API container
 * can proxy Redfish Reset via the Windows host LAN stack:
 *   POST http://127.0.0.1:38765/reboot
 *   { "device_id": "<uuid>", "reset_type": "PowerCycle" }
 *
 * Usage (from repo root, with stack up and Postgres published on 5432):
 *   node backend/scripts/network-host-poller.js
 */
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

// Ensure we actually probe from the host (do not inherit skip from compose .env)
delete process.env.NETWORK_SKIP_CONTAINER_POLLER;
delete process.env.NETWORK_REBOOT_VIA_HOST;
delete process.env.NETWORK_PRECHECK_VIA_HOST;

const { tick, runSyncNow, runProbeNow } = require('../src/services/network-poller');
const {
  rebootDeviceDirect,
  loadDevice,
  ALLOWED_RESET_TYPES,
} = require('../src/services/network-reboot');
const { resetBmcDeviceDirect, ALLOWED_BMC_RESET_TYPES } = require('../src/services/network-bmc-reset');
const { precheckDeviceDirect } = require('../src/services/network-subcloud-precheck');
const { listDevicePodsDirect, listAllClusterPods } = require('../src/services/network-cluster-pods');
const { trackPodResultInBackground } = require('../src/services/network-samsung-software-tracker');
const {
  fetchSubcloudRecordsDirect,
} = require('../src/services/network-subcloud-middleware');
const { fetchConnectionDetailsDirect } = require('../src/services/network-connection-details');
const { triggerSetupClusterDirect } = require('../src/services/network-setup-cluster');
const { atlasFetchDirect } = require('../src/services/network-samsung-precheck');
const {
  hostAgentToken,
  requestHasValidAgentToken,
  TOKEN_HEADER,
} = require('../src/services/network-host-agent');

const PROBE_INTERVAL_MS = Number(process.env.NETWORK_PROBE_INTERVAL_MS) || 45_000;
const AGENT_PORT = Number(process.env.NETWORK_HOST_AGENT_PORT) || 38765;
// Docker Desktop reaches the host over host.docker.internal, which does not map
// to loopback, so the default bind stays LAN-visible and the shared secret is
// what gates access. Set to 127.0.0.1 when the API runs on this same host.
const AGENT_BIND = process.env.NETWORK_HOST_AGENT_BIND?.trim() || '0.0.0.0';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function startAgent() {
  const server = http.createServer(async (req, res) => {
    try {
      // Liveness only, no device data — left open so the supervisor scripts can
      // poll it without holding the shared secret.
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true, role: 'network-host-agent' });
        return;
      }

      if (!requestHasValidAgentToken(req)) {
        console.warn(`Rejected unauthenticated ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
        sendJson(res, 401, { error: `Missing or invalid ${TOKEN_HEADER}` });
        return;
      }

      if (req.method === 'POST' && req.url === '/reboot') {
        const body = await readJsonBody(req);
        const deviceId = body.device_id;
        const resetType = body.reset_type || 'PowerCycle';
        if (!deviceId) {
          sendJson(res, 400, { error: 'device_id required' });
          return;
        }
        if (!ALLOWED_RESET_TYPES.has(resetType)) {
          sendJson(res, 400, {
            error: `Unsupported reset_type. Allowed: ${[...ALLOWED_RESET_TYPES].join(', ')}`,
          });
          return;
        }
        const device = await loadDevice(deviceId);
        if (!device) {
          sendJson(res, 404, { error: 'Device not found' });
          return;
        }
        if (body.confirm_cluster_id !== device.cluster_id) {
          sendJson(res, 400, {
            error: `Confirmation required: send confirm_cluster_id matching "${device.cluster_id}"`,
          });
          return;
        }
        const result = await rebootDeviceDirect(device, resetType);
        console.log(`Reboot ${result.cluster_id} (${result.bmc_ip}) → ${resetType}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && req.url === '/bmc-reset') {
        const body = await readJsonBody(req);
        const deviceId = body.device_id;
        const resetType = body.reset_type || 'GracefulRestart';
        if (!deviceId) {
          sendJson(res, 400, { error: 'device_id required' });
          return;
        }
        if (!ALLOWED_BMC_RESET_TYPES.has(resetType)) {
          sendJson(res, 400, {
            error: `Unsupported reset_type. Allowed: ${[...ALLOWED_BMC_RESET_TYPES].join(', ')}`,
          });
          return;
        }
        const device = await loadDevice(deviceId);
        if (!device) {
          sendJson(res, 404, { error: 'Device not found' });
          return;
        }
        if (body.confirm_cluster_id !== device.cluster_id) {
          sendJson(res, 400, {
            error: `Confirmation required: send confirm_cluster_id matching "${device.cluster_id}"`,
          });
          return;
        }
        const result = await resetBmcDeviceDirect(device, resetType);
        console.log(`BMC reset ${result.cluster_id} (${result.bmc_ip}) → ${resetType}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && req.url === '/precheck') {
        const body = await readJsonBody(req);
        const deviceId = body.device_id;
        if (!deviceId) {
          sendJson(res, 400, { error: 'device_id required' });
          return;
        }
        const result = await precheckDeviceDirect(deviceId);
        console.log(`Precheck ${result.cluster_id} → ${result.status}`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/pods')) {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        const deviceId = parsed.searchParams.get('device_id');
        if (deviceId) {
          try {
            const result = await listDevicePodsDirect(deviceId);
            trackPodResultInBackground(deviceId, result);
            console.log(`Pods ${result.cluster_id} → ${result.running}/${result.total} running`);
            sendJson(res, 200, result);
          } catch (err) {
            sendJson(res, err.status || 500, { error: err.message || 'Pod listing failed' });
          }
          return;
        }
        try {
          const result = await listAllClusterPods();
          for (const cluster of result.clusters || []) {
            if (cluster.device_id) trackPodResultInBackground(cluster.device_id, cluster);
          }
          console.log(`Pods all clusters → ${result.clusters?.length ?? 0} namespace(s)`);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, err.status || 500, { error: err.message || 'Pod listing failed' });
        }
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/middleware/subcloud')) {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        const fuzeSiteId = parsed.searchParams.get('fuze_site_id');
        if (!fuzeSiteId?.trim()) {
          sendJson(res, 400, { error: 'fuze_site_id required' });
          return;
        }
        const records = await fetchSubcloudRecordsDirect(fuzeSiteId.trim());
        console.log(`Middleware Fuze ${fuzeSiteId.trim()} → ${records.length} subcloud(s)`);
        sendJson(res, 200, { fuze_site_id: fuzeSiteId.trim(), records });
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/middleware/connection-details')) {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        const clusterName = parsed.searchParams.get('cluster_name');
        if (!clusterName?.trim()) {
          sendJson(res, 400, { error: 'cluster_name required' });
          return;
        }
        const result = await fetchConnectionDetailsDirect(clusterName.trim());
        console.log(`Connection details ${clusterName.trim()} → ok`);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/middleware/setup-cluster')) {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        const clusterName = parsed.searchParams.get('cluster_name');
        if (!clusterName?.trim()) {
          sendJson(res, 400, { error: 'cluster_name required' });
          return;
        }
        const result = await triggerSetupClusterDirect(clusterName.trim());
        console.log(`Setup cluster ${clusterName.trim()} → ok`);
        sendJson(res, 200, result);
        return;
      }

      if (req.url?.startsWith('/atlas/')) {
        const atlasPath = req.url.slice('/atlas'.length) || '/';
        let body;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = await readJsonBody(req);
        }
        try {
          const result = await atlasFetchDirect(atlasPath, {
            method: req.method,
            body: body != null && Object.keys(body).length ? body : undefined,
          });
          console.log(`Atlas ${req.method} ${atlasPath} → ok`);
          sendJson(res, 200, result);
        } catch (err) {
          console.error(`Atlas ${req.method} ${atlasPath} → ${err.message}`);
          sendJson(res, err.status || 500, { error: err.message, atlas: err.atlas });
        }
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('Host agent error:', err.message);
      sendJson(res, err.status || 500, { error: err.message || 'Host agent error' });
    }
  });

  server.listen(AGENT_PORT, AGENT_BIND, () => {
    console.log(`Host reboot agent listening on ${AGENT_BIND}:${AGENT_PORT} (token required)`);
  });

  return server;
}

async function main() {
  if (!hostAgentToken()) {
    console.error(
      [
        'NETWORK_HOST_AGENT_TOKEN is not set.',
        '',
        'This agent can reboot hardware and launch Atlas jobs, so it refuses to',
        'start without a shared secret. Generate one and add it to .env (the same',
        'value must be visible to the API container):',
        '',
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        '',
        '  NETWORK_HOST_AGENT_TOKEN=<generated-value>',
      ].join('\n')
    );
    process.exit(1);
  }

  console.log(`Network host poller -> ${process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`Probe interval ${PROBE_INTERVAL_MS}ms`);
  startAgent();

  try {
    const sync = await runSyncNow();
    console.log(`Inventory synced: ${sync.synced} devices`);
  } catch (err) {
    console.warn('Initial sync failed:', err.message);
  }

  try {
    const probe = await runProbeNow();
    console.log(`Probed ${probe.probed} devices`);
  } catch (err) {
    console.warn('Initial probe failed:', err.message);
  }

  setInterval(() => {
    tick().catch((err) => console.error('Host poller tick failed:', err.message));
  }, PROBE_INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
