/**
 * Trigger host reboot via local API and monitor BMC power/Redfish.
 * Usage: node backend/scripts/reboot-and-monitor.js 29991573174 [GracefulRestart|ForceRestart]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');

const API = 'http://127.0.0.1/api';
const POLL_MS = 10_000;
const MAX_MS = 8 * 60_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadSnap(clusterId) {
  const { rows } = await db.query(
    `SELECT d.cluster_id, d.bmc_ip, d.vendor,
            s.reachable, s.latency_ms, s.redfish_ok, s.health, s.error, s.probed_at
     FROM network_devices d
     LEFT JOIN network_device_snapshots s ON s.device_id = d.id
     WHERE d.cluster_id = $1`,
    [clusterId]
  );
  return rows[0] || null;
}

function summarize(row) {
  return {
    ts: new Date().toISOString(),
    reachable: row?.reachable ?? null,
    redfish_ok: row?.redfish_ok ?? null,
    power: row?.health?.system?.power ?? null,
    health: row?.health?.system?.health ?? null,
    latency_ms: row?.latency_ms ?? null,
    error: row?.error ?? null,
    probed_at: row?.probed_at ?? null,
  };
}

async function main() {
  const clusterId = process.argv[2];
  const resetType = process.argv[3] || 'GracefulRestart';
  if (!clusterId) throw new Error('cluster_id required');

  const token = process.env.AUTH_API_TOKEN || process.env.MISSION_CONTROL_API_TOKEN;
  if (!token) throw new Error('AUTH_API_TOKEN not set');

  const { rows } = await db.query(
    'SELECT id, cluster_id, bmc_ip, vendor FROM network_devices WHERE cluster_id = $1',
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error('device not found');

  const before = await loadSnap(clusterId);
  console.log('BEFORE', JSON.stringify(summarize(before), null, 2));

  console.log(`\nSending Host Reboot (${resetType}) via local API...`);
  const res = await fetch(`${API}/network/devices/${device.id}/reboot`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      confirm_cluster_id: device.cluster_id,
      reset_type: resetType,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  console.log('REBOOT_RESPONSE', JSON.stringify({ status: res.status, body }, null, 2));
  if (!res.ok) {
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  let sawOffOrUnknown = false;
  let sawOnAgain = false;
  let lastPower = before?.health?.system?.power || null;

  console.log(`\nMonitoring every ${POLL_MS / 1000}s for up to ${MAX_MS / 60000} min...`);
  while (Date.now() - started < MAX_MS) {
    await sleep(POLL_MS);
    const snap = await loadSnap(clusterId);
    const s = summarize(snap);
    const power = s.power;
    if (power && power !== lastPower) {
      console.log('POWER_CHANGE', JSON.stringify(s));
      lastPower = power;
    } else {
      console.log('POLL', JSON.stringify(s));
    }

    const p = String(power || '').toLowerCase();
    if (['off', 'poweringoff', 'paused'].includes(p) || s.redfish_ok === false || s.reachable === false) {
      sawOffOrUnknown = true;
    }
    if (sawOffOrUnknown && p === 'on' && s.redfish_ok) {
      sawOnAgain = true;
      console.log('\nRESULT host appears back On after reboot cycle');
      break;
    }
  }

  const after = await loadSnap(clusterId);
  console.log('\nAFTER', JSON.stringify(summarize(after), null, 2));
  console.log(
    JSON.stringify(
      {
        reboot_accepted: true,
        saw_power_drop_or_unreachable: sawOffOrUnknown,
        saw_on_again: sawOnAgain,
        elapsed_ms: Date.now() - started,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch {
      /* ignore */
    }
  });
