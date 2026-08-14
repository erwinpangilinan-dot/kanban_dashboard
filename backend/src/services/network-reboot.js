const db = require('../db');
const { getVendorCredentials } = require('./network-credentials');
const { rebootRedfishDell, ALLOWED_RESET_TYPES } = require('./network-probe');
const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');

function shouldUseHostAgent() {
  return (
    process.env.NETWORK_SKIP_CONTAINER_POLLER === '1' ||
    process.env.NETWORK_REBOOT_VIA_HOST === '1'
  );
}

async function loadDevice(deviceId) {
  const { rows } = await db.query(
    'SELECT id, cluster_id, bmc_ip, vendor FROM network_devices WHERE id = $1',
    [deviceId]
  );
  return rows[0] || null;
}

async function rebootDeviceDirect(device, resetType) {
  const creds = await getVendorCredentials(device.vendor || 'DELL');
  if (!creds.configured) {
    const err = new Error(`Redfish credentials not configured for vendor ${device.vendor || 'DELL'}`);
    err.status = 400;
    throw err;
  }
  await rebootRedfishDell(device.bmc_ip, {
    username: creds.username,
    password: creds.password,
    resetType,
  });
  return {
    id: device.id,
    cluster_id: device.cluster_id,
    bmc_ip: device.bmc_ip,
    vendor: device.vendor,
    reset_type: resetType,
    via: 'api',
    ok: true,
  };
}

async function rebootDeviceViaHostAgent(device, resetType) {
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${base}/reboot`, {
      method: 'POST',
      headers: hostAgentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        device_id: device.id,
        reset_type: resetType,
        confirm_cluster_id: device.cluster_id,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (!res.ok) {
      const err = new Error(data.error || `Host agent reboot failed (HTTP ${res.status})`);
      err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
      throw err;
    }
    return { ...data, via: 'host-agent' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(
        `Host agent timed out at ${base}. Is the network host poller running?`
      );
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
      const connErr = new Error(
        `Cannot reach host reboot agent at ${base}. Start scripts/start-network-host-poller.ps1 on Windows.`
      );
      connErr.status = 502;
      throw connErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reboot a vDU via Dell Redfish Reset.
 * On Docker Desktop (NETWORK_SKIP_CONTAINER_POLLER=1), proxies to the host agent
 * so BMC IPv6 is reachable from the Windows LAN.
 */
async function rebootDevice(deviceId, { resetType = 'PowerCycle', confirmClusterId } = {}) {
  if (!ALLOWED_RESET_TYPES.has(resetType)) {
    const err = new Error(`Unsupported reset_type: ${resetType}`);
    err.status = 400;
    throw err;
  }

  const device = await loadDevice(deviceId);
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }
  if (!device.bmc_ip) {
    const err = new Error('Device has no BMC IP');
    err.status = 400;
    throw err;
  }
  if (!confirmClusterId || confirmClusterId !== device.cluster_id) {
    const err = new Error(
      `Confirmation required: send confirm_cluster_id matching "${device.cluster_id}"`
    );
    err.status = 400;
    throw err;
  }

  if (shouldUseHostAgent()) {
    return rebootDeviceViaHostAgent(device, resetType);
  }
  return rebootDeviceDirect(device, resetType);
}

module.exports = {
  rebootDevice,
  rebootDeviceDirect,
  loadDevice,
  ALLOWED_RESET_TYPES,
  hostAgentBaseUrl,
  shouldUseHostAgent,
};
