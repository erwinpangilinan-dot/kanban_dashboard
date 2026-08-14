const { getVendorCredentials } = require('./network-credentials');
const {
  resetBmcRedfish,
  resetBmcIpmitool,
  isZtVendor,
  ALLOWED_BMC_RESET_TYPES,
} = require('./network-probe');
const { shouldUseHostAgent, loadDevice } = require('./network-reboot');
const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');

async function resetBmcDeviceDirect(device, resetType) {
  const vendor = device.vendor || 'DELL';
  const credKey = isZtVendor(vendor) ? 'ZT' : vendor;
  const creds = await getVendorCredentials(credKey);
  if (!creds.configured) {
    const err = new Error(`BMC credentials not configured for vendor ${credKey}`);
    err.status = 400;
    throw err;
  }

  const credOpts = {
    username: creds.username,
    password: creds.password,
    resetType,
  };

  const result = isZtVendor(vendor)
    ? await resetBmcIpmitool(device.bmc_ip, credOpts)
    : await resetBmcRedfish(device.bmc_ip, credOpts);

  return {
    id: device.id,
    cluster_id: device.cluster_id,
    bmc_ip: device.bmc_ip,
    vendor: device.vendor,
    target: 'bmc',
    reset_type: resetType,
    method: result.method || 'redfish',
    manager: result.manager || null,
    ipmitool_mode: result.ipmitool_mode || null,
    via: 'api',
    ok: true,
  };
}

async function resetBmcDeviceViaHostAgent(device, resetType) {
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${base}/bmc-reset`, {
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
      const err = new Error(data.error || `Host agent BMC reset failed (HTTP ${res.status})`);
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
        `Cannot reach host agent at ${base}. Start scripts/start-network-host-poller.ps1 on Windows.`
      );
      connErr.status = 502;
      throw connErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function resetBmcDevice(deviceId, { resetType = 'GracefulRestart', confirmClusterId } = {}) {
  if (!ALLOWED_BMC_RESET_TYPES.has(resetType)) {
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

  // ZT Proteus BMC reset uses ipmitool; host poller has LAN IPv6 + ipmitool/WSL.
  if (shouldUseHostAgent() || isZtVendor(device.vendor)) {
    return resetBmcDeviceViaHostAgent(device, resetType);
  }
  return resetBmcDeviceDirect(device, resetType);
}

module.exports = {
  resetBmcDevice,
  resetBmcDeviceDirect,
  ALLOWED_BMC_RESET_TYPES,
};
