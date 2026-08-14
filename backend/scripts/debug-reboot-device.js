/**
 * Inspect device + try dry diagnostics for host reboot eligibility.
 * Usage: node backend/scripts/debug-reboot-device.js 29991573174
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { shouldUseHostAgent } = require('../src/services/network-reboot');
const { hostAgentBaseUrl, hostAgentHeaders } = require('../src/services/network-host-agent');

async function probeHostAgent() {
  const base = hostAgentBaseUrl();
  try {
    const res = await fetch(`${base}/health`, { headers: hostAgentHeaders() });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { body: text.slice(0, 200) };
    }
    return { base, http: res.status, ...data };
  } catch (err) {
    return { base, ok: false, error: err.message };
  }
}

async function main() {
  const clusterId = process.argv[2];
  if (!clusterId) {
    console.error('Usage: node debug-reboot-device.js <gNB DUID>');
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT d.id, d.cluster_id, d.cluster_name, d.vendor, d.bmc_ip, d.application, d.model,
            s.reachable, s.latency_ms, s.redfish_ok, s.health, s.error, s.probed_at
     FROM network_devices d
     LEFT JOIN network_device_snapshots s ON s.device_id = d.id
     WHERE d.cluster_id = $1`,
    [clusterId]
  );
  if (!rows[0]) {
    console.error('Device not found:', clusterId);
    process.exit(1);
  }
  const d = rows[0];
  const hostAgent = await probeHostAgent();
  console.log(
    JSON.stringify(
      {
        device: {
          id: d.id,
          cluster_id: d.cluster_id,
          cluster_name: d.cluster_name,
          vendor: d.vendor,
          bmc_ip: d.bmc_ip,
          application: d.application,
          model: d.model,
        },
        snapshot: {
          reachable: d.reachable,
          latency_ms: d.latency_ms,
          redfish_ok: d.redfish_ok,
          power: d.health?.system?.power,
          error: d.error,
          probed_at: d.probed_at,
        },
        should_use_host_agent: shouldUseHostAgent(),
        host_agent: hostAgent,
        reboot_path_note:
          String(d.vendor || '').toUpperCase() === 'DELL'
            ? 'Dell path uses rebootRedfishDell'
            : 'Non-Dell vendors may fail or be unsupported by host reboot',
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
