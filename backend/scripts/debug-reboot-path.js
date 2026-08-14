/**
 * Non-destructive reboot path check (wrong confirm_cluster_id → must 400).
 * Usage: node backend/scripts/debug-reboot-path.js 29991573174
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { hostAgentBaseUrl, hostAgentHeaders } = require('../src/services/network-host-agent');

async function main() {
  const clusterId = process.argv[2];
  if (!clusterId) throw new Error('cluster_id required');

  const { rows } = await db.query(
    'SELECT id, cluster_id, bmc_ip, vendor FROM network_devices WHERE cluster_id = $1',
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error('device not found');

  const apiBase = process.env.MISSION_CONTROL_API_URL || 'http://127.0.0.1/api';
  const token = process.env.AUTH_API_TOKEN || process.env.MISSION_CONTROL_API_TOKEN;
  if (!token) throw new Error('AUTH_API_TOKEN / MISSION_CONTROL_API_TOKEN not set');

  // 1) API with wrong confirm — must not reboot
  const apiRes = await fetch(`${apiBase}/network/devices/${device.id}/reboot`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      confirm_cluster_id: 'WRONG-CONFIRM',
      reset_type: 'GracefulRestart',
    }),
  });
  const apiText = await apiRes.text();
  let apiBody;
  try {
    apiBody = JSON.parse(apiText);
  } catch {
    apiBody = { raw: apiText.slice(0, 300) };
  }

  // 2) Host agent with wrong confirm — must not reboot
  const agentBase = hostAgentBaseUrl().includes('host.docker.internal')
    ? 'http://127.0.0.1:38765'
    : hostAgentBaseUrl();
  const agentRes = await fetch(`${agentBase}/reboot`, {
    method: 'POST',
    headers: hostAgentHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      device_id: device.id,
      confirm_cluster_id: 'WRONG-CONFIRM',
      reset_type: 'GracefulRestart',
    }),
  });
  const agentText = await agentRes.text();
  let agentBody;
  try {
    agentBody = JSON.parse(agentText);
  } catch {
    agentBody = { raw: agentText.slice(0, 300) };
  }

  console.log(
    JSON.stringify(
      {
        device: {
          id: device.id,
          cluster_id: device.cluster_id,
          vendor: device.vendor,
          bmc_ip: device.bmc_ip,
        },
        api_wrong_confirm: { url: `${apiBase}/network/devices/${device.id}/reboot`, status: apiRes.status, body: apiBody },
        agent_wrong_confirm: { url: `${agentBase}/reboot`, status: agentRes.status, body: agentBody },
        interpretation:
          apiRes.status === 400 && agentRes.status === 400
            ? 'Reboot path reachable; confirmation gate works. No reboot was sent.'
            : 'Unexpected response — check auth/token/proxy.',
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
