/**
 * Monitor Samsung Atlas snapshots for one or more cluster IDs.
 * Usage: node backend/scripts/monitor-samsung-clusters.js 29991573162 29991573163
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const {
  getSamsungPrecheckStatus,
  loadSamsungAtlasSnapshot,
  persistSamsungAtlasStatus,
  normalizeAtlasOperation,
} = require('../src/services/network-samsung-precheck');

const clusterIds = process.argv.slice(2);
const POLL_MS = 8_000;
const MAX_MS = 25 * 60_000;

async function loadDevice(clusterId) {
  const { rows } = await db.query(
    'SELECT * FROM network_devices WHERE cluster_id = $1 LIMIT 1',
    [clusterId]
  );
  return rows[0] || null;
}

async function refreshCluster(device, operation) {
  const stored = await loadSamsungAtlasSnapshot(device.id, operation);
  if (!stored?.launched_at) return null;
  const status = await getSamsungPrecheckStatus({
    clusterId: device.cluster_id,
    launchedAfter: stored.launched_at,
    launcherJobId: stored.launcher_job_id,
    monitorJobId: stored.monitor_job_id,
    monitorJobKind: stored.monitor_job_kind,
    operation,
    workload: stored.workload,
  });
  await persistSamsungAtlasStatus(device.id, device, status, stored, operation);
  return { operation, stored, status };
}

async function findActiveRuns(device) {
  const ops = ['precheck', 'upgrade', 'rollback'];
  const active = [];
  for (const op of ops) {
    const snap = await loadSamsungAtlasSnapshot(device.id, op);
    if (!snap?.launched_at) continue;
    const age = Date.now() - new Date(snap.launched_at).getTime();
    const terminal = snap.status === 'success' || snap.status === 'failed';
    if (!terminal || age < 30 * 60_000) {
      active.push({ op, snap });
    }
  }
  return active;
}

function formatRun(clusterId, result) {
  const { operation, status, stored } = result;
  return {
    cluster_id: clusterId,
    operation,
    workload: stored.workload,
    phase: status.phase,
    status: status.status,
    message: status.message?.slice(0, 140),
    launcher: status.launcher_job_id,
    monitor: status.monitor_job_id,
    job: status.job?.name,
    job_status: status.job?.status,
    activity: status.activity?.recent?.slice(0, 3).map((r) => ({
      ts: r.timestamp,
      status: r.status,
      summary: r.summary,
      job_id: r.job_id,
    })),
  };
}

function allTerminal(results) {
  return results.every((r) => r.status.status === 'success' || r.status.status === 'failed');
}

async function monitorOnce() {
  const out = [];
  for (const clusterId of clusterIds) {
    const device = await loadDevice(clusterId);
    if (!device) {
      out.push({ cluster_id: clusterId, error: 'device not found' });
      continue;
    }
    const runs = await findActiveRuns(device);
    if (!runs.length) {
      out.push({ cluster_id: clusterId, note: 'no recent atlas snapshot' });
      continue;
    }
    for (const { op } of runs) {
      const result = await refreshCluster(device, op);
      if (result) out.push(formatRun(clusterId, result));
    }
  }
  return out;
}

async function main() {
  if (!clusterIds.length) {
    console.error('Usage: monitor-samsung-clusters.js <cluster_id> [...]');
    process.exit(1);
  }

  const start = Date.now();
  console.log(`Monitoring: ${clusterIds.join(', ')} (poll every ${POLL_MS / 1000}s)\n`);

  while (Date.now() - start < MAX_MS) {
    const ts = new Date().toISOString();
    const results = await monitorOnce();
    console.log(`--- ${ts} ---`);
    console.log(JSON.stringify(results, null, 2));

    const flat = results.filter((r) => r.status);
    if (flat.length && flat.every((r) => r.status === 'success' || r.status === 'failed')) {
      console.log('\nAll tracked runs reached terminal state.');
      break;
    }

    const anyActive = flat.some((r) => r.status !== 'success' && r.status !== 'failed');
    if (!anyActive && !results.some((r) => r.note || r.error)) {
      break;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
