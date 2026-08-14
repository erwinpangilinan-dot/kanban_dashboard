/**
 * Non-destructive local reboot path check for a gNB DUID.
 * Does NOT send a real Redfish reset (uses wrong confirm_cluster_id).
 *
 * Usage: node backend/scripts/debug-local-reboot-path.js 29991573174
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { getVendorCredentials } = require('../src/services/network-credentials');
const { hostAgentBaseUrl, hostAgentHeaders } = require('../src/services/network-host-agent');

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

async function main() {
  const clusterId = process.argv[2];
  if (!clusterId) throw new Error('cluster_id required');

  const { rows } = await db.query(
    `SELECT d.id, d.cluster_id, d.vendor, d.bmc_ip,
            s.reachable, s.redfish_ok, s.health, s.error, s.probed_at
     FROM network_devices d
     LEFT JOIN network_device_snapshots s ON s.device_id = d.id
     WHERE d.cluster_id = $1`,
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error('device not found');

  const token = process.env.AUTH_API_TOKEN || process.env.MISSION_CONTROL_API_TOKEN;
  const creds = await getVendorCredentials(device.vendor || 'DELL');

  const localApi = 'http://127.0.0.1/api';
  const agentLoopback = 'http://127.0.0.1:38765';
  const agentFromEnv = hostAgentBaseUrl();

  const authHeaders = {
    Authorization: `Bearer ${token || ''}`,
    'Content-Type': 'application/json',
  };

  const checks = {};

  // Local API wrong-confirm (must 400; proves route + auth)
  try {
    checks.local_api_wrong_confirm = await postJson(
      `${localApi}/network/devices/${device.id}/reboot`,
      authHeaders,
      { confirm_cluster_id: 'WRONG', reset_type: 'GracefulRestart' }
    );
  } catch (err) {
    checks.local_api_wrong_confirm = { error: err.message };
  }

  // Local API missing auth
  try {
    checks.local_api_no_auth = await postJson(
      `${localApi}/network/devices/${device.id}/reboot`,
      { 'Content-Type': 'application/json' },
      { confirm_cluster_id: device.cluster_id, reset_type: 'GracefulRestart' }
    );
  } catch (err) {
    checks.local_api_no_auth = { error: err.message };
  }

  // Host agent wrong-confirm from loopback
  try {
    checks.agent_loopback_wrong_confirm = await postJson(
      `${agentLoopback}/reboot`,
      hostAgentHeaders({ 'Content-Type': 'application/json' }),
      {
        device_id: device.id,
        confirm_cluster_id: 'WRONG',
        reset_type: 'GracefulRestart',
      }
    );
  } catch (err) {
    checks.agent_loopback_wrong_confirm = { error: err.message };
  }

  // Agent health
  try {
    const res = await fetch(`${agentLoopback}/health`);
    checks.agent_health = { status: res.status, body: await res.json() };
  } catch (err) {
    checks.agent_health = { error: err.message };
  }

  // What the API container sees for host agent (via docker exec would be better;
  // here we only report env the host process has).
  checks.env = {
    NETWORK_SKIP_CONTAINER_POLLER: process.env.NETWORK_SKIP_CONTAINER_POLLER || null,
    NETWORK_REBOOT_VIA_HOST: process.env.NETWORK_REBOOT_VIA_HOST || null,
    NETWORK_HOST_AGENT_URL: process.env.NETWORK_HOST_AGENT_URL || null,
    agent_base_resolved: agentFromEnv,
    auth_token_configured: Boolean(token),
    host_agent_token_configured: Boolean(process.env.NETWORK_HOST_AGENT_TOKEN),
    dell_creds_configured: Boolean(creds?.configured),
    dell_username_set: Boolean(creds?.username),
  };

  console.log(
    JSON.stringify(
      {
        device: {
          id: device.id,
          cluster_id: device.cluster_id,
          vendor: device.vendor,
          bmc_ip: device.bmc_ip,
          reachable: device.reachable,
          redfish_ok: device.redfish_ok,
          power: device.health?.system?.power || null,
          error: device.error,
          probed_at: device.probed_at,
        },
        checks,
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
