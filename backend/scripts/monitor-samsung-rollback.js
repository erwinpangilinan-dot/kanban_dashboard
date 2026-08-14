/**
 * Monitor Samsung Atlas rollback for one or more gNB DUIDs.
 * Usage: node backend/scripts/monitor-samsung-rollback.js [cluster_id ...]
 *   Default: 29991573162 29991573163
 * Env: MONITOR_INTERVAL_MS=15000 MONITOR_MAX_POLLS=120
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const {
  loadSamsungAtlasSnapshot,
  getSamsungPrecheckStatus,
  persistSamsungAtlasStatus,
  mergeSessionActivity,
  resolveSessionLauncherId,
} = require('../src/services/network-samsung-precheck');

const INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS) || 15_000;
const MAX_POLLS = Number(process.env.MONITOR_MAX_POLLS) || 120;
const clusterIds = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['29991573162', '29991573163'];

function ts() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isTerminal(status) {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

async function pollCluster(clusterId) {
  const { rows } = await db.query(
    'SELECT id, cluster_id FROM network_devices WHERE cluster_id = $1 LIMIT 1',
    [clusterId]
  );
  const device = rows[0];
  if (!device) return { cluster_id: clusterId, error: 'device not found' };

  const snap = await loadSamsungAtlasSnapshot(device.id, 'rollback');
  if (!snap?.launcher_job_id && !snap?.launched_at) {
    return {
      cluster_id: clusterId,
      workload: snap?.workload || null,
      status: snap?.status || 'none',
      phase: snap?.phase || 'idle',
      message: snap?.message || 'No rollback snapshot — launch rollback from dashboard',
      monitor_job_id: null,
      job_name: null,
      launcher_job_id: null,
      launched_at: null,
      activity_count: 0,
    };
  }

  const live = await getSamsungPrecheckStatus({
    clusterId,
    launchedAfter: snap.launched_at,
    launcherJobId: snap.launcher_job_id,
    sessionLauncherJobId: resolveSessionLauncherId(
      snap,
      snap.launcher_job_id,
      snap.launcher_job_id
    ),
    monitorJobId: snap.monitor_job_id,
    monitorJobKind: snap.monitor_job_kind,
    operation: 'rollback',
    workload: snap.workload,
  });
  live.activity = mergeSessionActivity(snap, live);

  await persistSamsungAtlasStatus(device.id, device, live, snap, 'rollback');

  return {
    cluster_id: clusterId,
    workload: snap.workload,
    status: live.status,
    phase: live.phase,
    message: live.message,
    monitor_job_id: live.monitor_job_id,
    job_name: live.job?.name,
    launcher_job_id: live.launcher_job_id,
    session_launcher_job_id: snap.session_launcher_job_id,
    launched_at: snap.launched_at,
    activity_count: live.activity?.count,
    activity_recent: live.activity?.recent?.slice(0, 6).map((e) => ({
      id: e.job_id,
      status: e.status,
      summary: e.summary,
    })),
    checked_at: live.checked_at,
  };
}

function printRow(row) {
  const tag = `[${ts()}] ${row.cluster_id} (${row.workload || '?'})`;
  if (row.error) {
    console.log(`${tag} ERROR: ${row.error}`);
    return;
  }
  console.log(
    `${tag} ${row.status?.toUpperCase()} | ${row.phase} | monitor=#${row.monitor_job_id || '—'} ${row.job_name || ''}`
  );
  if (row.message) console.log(`         ${row.message.replace(/\n/g, ' · ')}`);
  if (row.activity_recent?.length) {
    for (const e of row.activity_recent) {
      console.log(`         · #${e.id} ${e.status} ${e.summary}`);
    }
  }
}

(async () => {
  console.log(`Monitoring rollback: ${clusterIds.join(', ')}`);
  console.log(`Poll every ${INTERVAL_MS / 1000}s (max ${MAX_POLLS} polls)\n`);

  const lastSeen = new Map();

  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const results = await Promise.all(clusterIds.map((cid) => pollCluster(cid)));
    let allTerminal = true;
    let anyNewLaunch = false;

    for (const row of results) {
      const key = `${row.cluster_id}:${row.launcher_job_id}:${row.monitor_job_id}:${row.status}:${row.message}`;
      const prev = lastSeen.get(row.cluster_id);
      if (!prev || prev !== key) {
        printRow(row);
        lastSeen.set(row.cluster_id, key);
        if (prev && row.launcher_job_id && !prev.startsWith(`${row.cluster_id}:${row.launcher_job_id}`)) {
          anyNewLaunch = true;
        }
      }
      if (!isTerminal(row.status) && row.status !== 'none') allTerminal = false;
      if (row.status === 'none' || row.phase === 'idle') allTerminal = false;
    }

    if (poll === 1 && results.every((r) => isTerminal(r.status))) {
      console.log('\nBoth rollbacks already terminal — waiting for new launch…');
    }

    if (allTerminal && poll > 1 && results.some((r) => isTerminal(r.status))) {
      const allDone = results.every((r) => isTerminal(r.status) || r.status === 'none');
      if (allDone && !results.some((r) => r.status === 'none')) {
        console.log('\nAll monitored rollbacks reached terminal state.');
        break;
      }
    }

    if (poll < MAX_POLLS) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  console.log('\nMonitor session ended.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
