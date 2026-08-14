const db = require('../db');
const { syncInventoryFromSheet } = require('./network-sync');
const { getVendorCredentials } = require('./network-credentials');
const { probeDevice, probeSubcloud } = require('./network-probe');

async function resolveProbeCredentials(device) {
  const sheetVendor = String(device.vendor || 'DELL').toUpperCase();
  const modelType = String(device.model_type || '').toLowerCase();
  const model = String(device.model || '').toLowerCase();
  const isHpeE930 =
    modelType.includes('sapphire') ||
    model.includes('e930') ||
    model.includes('edgeline');
  const primary = await getVendorCredentials(sheetVendor);

  const alt = [];
  if (sheetVendor === 'ZT' && isHpeE930) {
    const hpe = await getVendorCredentials('HPE');
    const ordered = [];
    if (hpe.configured) ordered.push(hpe);
    if (primary.configured) ordered.push(primary);
    const pick = ordered[0] || primary;
    return {
      primary: pick,
      altCredsList: ordered.slice(1).map((c) => ({
        username: c.username,
        password: c.password,
      })),
    };
  }
  if (sheetVendor === 'ZT') {
    const hpe = await getVendorCredentials('HPE');
    if (hpe.configured) alt.push(hpe);
  } else if (sheetVendor === 'HPE') {
    const zt = await getVendorCredentials('ZT');
    if (zt.configured) alt.push(zt);
  }

  return {
    primary,
    altCredsList: alt.filter((c) => c.configured).map((c) => ({
      username: c.username,
      password: c.password,
    })),
  };
}

const PROBE_INTERVAL_MS = Number(process.env.NETWORK_PROBE_INTERVAL_MS) || 45_000;
const SYNC_INTERVAL_MS = Number(process.env.NETWORK_SYNC_INTERVAL_MS) || 5 * 60_000;
const SKIP_CONTAINER_POLLER =
  process.env.NETWORK_SKIP_CONTAINER_POLLER === '1' ||
  process.env.NETWORK_SKIP_CONTAINER_POLLER === 'true';

let running = false;
let lastSyncAt = 0;
let timer = null;

async function saveSnapshot(deviceId, result) {
  await db.query(
    `INSERT INTO network_device_snapshots
       (device_id, reachable, latency_ms, redfish_ok, health, error, probed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
     ON CONFLICT (device_id) DO UPDATE SET
       reachable = EXCLUDED.reachable,
       latency_ms = EXCLUDED.latency_ms,
       redfish_ok = EXCLUDED.redfish_ok,
       health = EXCLUDED.health,
       error = EXCLUDED.error,
       probed_at = EXCLUDED.probed_at`,
    [
      deviceId,
      result.reachable,
      result.latency_ms,
      result.redfish_ok,
      JSON.stringify(result.health || {}),
      result.error,
    ]
  );
}

async function saveSubcloudSnapshot(deviceId, result) {
  await db.query(
    `INSERT INTO network_subcloud_snapshots
       (device_id, reachable, latency_ms, error, probed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (device_id) DO UPDATE SET
       reachable = EXCLUDED.reachable,
       latency_ms = EXCLUDED.latency_ms,
       error = EXCLUDED.error,
       probed_at = EXCLUDED.probed_at`,
    [deviceId, result.reachable, result.latency_ms, result.error]
  );
}

async function probeAllSubclouds() {
  const { rows: devices } = await db.query(
    `SELECT id, cluster_id, subcloud_ip
     FROM network_devices
     WHERE subcloud_ip IS NOT NULL AND TRIM(subcloud_ip) <> ''
     ORDER BY cluster_id`
  );

  for (const device of devices) {
    try {
      const result = await probeSubcloud(device.subcloud_ip);
      await saveSubcloudSnapshot(device.id, result);
    } catch (err) {
      console.error(`Subcloud ping failed for ${device.cluster_id}:`, err.message);
      await saveSubcloudSnapshot(device.id, {
        reachable: false,
        latency_ms: null,
        error: err.message,
      });
    }
  }
  return { subcloud_probed: devices.length };
}

async function probeAllDevices() {
  const { rows: devices } = await db.query(
    'SELECT id, cluster_id, bmc_ip, vendor, model_type, model FROM network_devices ORDER BY cluster_id'
  );

  for (const device of devices) {
    try {
      const { primary, altCredsList } = await resolveProbeCredentials(device);
      const result = await probeDevice(
        device.bmc_ip,
        {
          username: primary.username,
          password: primary.password,
        },
        device.vendor,
        { altCredsList }
      );
      await saveSnapshot(device.id, result);
    } catch (err) {
      console.error(`Network probe failed for ${device.cluster_id}:`, err.message);
      await saveSnapshot(device.id, {
        reachable: false,
        latency_ms: null,
        redfish_ok: false,
        health: {},
        error: err.message,
      });
    }
  }
  return { probed: devices.length };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    if (now - lastSyncAt >= SYNC_INTERVAL_MS) {
      try {
        const sync = await syncInventoryFromSheet();
        lastSyncAt = now;
        console.log(`Network inventory synced: ${sync.synced} devices`);
      } catch (err) {
        console.warn('Network inventory sync skipped:', err.message);
        // still probe existing DB inventory
      }
    }
    await probeAllDevices();
    await probeAllSubclouds();
  } catch (err) {
    console.error('Network poller tick failed:', err.message);
  } finally {
    running = false;
  }
}

function startNetworkPoller() {
  if (timer) return;
  if (SKIP_CONTAINER_POLLER) {
    console.log(
      'Network container poller skipped (NETWORK_SKIP_CONTAINER_POLLER); use host poller for BMC probes'
    );
    // Still sync inventory periodically so UI has devices without host poller
    setTimeout(async () => {
      try {
        await runSyncNow();
        console.log('Network inventory synced (container sync-only mode)');
      } catch (err) {
        console.warn('Network inventory sync skipped:', err.message);
      }
      timer = setInterval(async () => {
        try {
          await runSyncNow();
        } catch (err) {
          console.warn('Network inventory sync skipped:', err.message);
        }
      }, SYNC_INTERVAL_MS);
    }, 5000);
    return;
  }
  console.log(
    `Network equipment poller started (probe ${PROBE_INTERVAL_MS}ms, sync ${SYNC_INTERVAL_MS}ms)`
  );
  // Initial delay so API can finish boot / migrations
  setTimeout(() => {
    tick();
    timer = setInterval(tick, PROBE_INTERVAL_MS);
  }, 5000);
}

async function runProbeNow() {
  if (SKIP_CONTAINER_POLLER) {
    return { probed: 0, subcloud_probed: 0, skipped: true, reason: 'NETWORK_SKIP_CONTAINER_POLLER' };
  }
  const bmc = await probeAllDevices();
  const sub = await probeAllSubclouds();
  return { ...bmc, ...sub };
}

async function runSyncNow() {
  const result = await syncInventoryFromSheet();
  lastSyncAt = Date.now();
  return result;
}

module.exports = {
  startNetworkPoller,
  runProbeNow,
  runSyncNow,
  tick,
};
