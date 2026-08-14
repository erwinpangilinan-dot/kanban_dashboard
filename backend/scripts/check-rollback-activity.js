require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const {
  getSamsungPrecheckStatus,
  loadSamsungAtlasSnapshot,
  mergeSessionActivity,
  resolveSessionLauncherId,
} = require('../src/services/network-samsung-precheck');

const clusterId = process.argv[2] || '29991572163';

(async () => {
  const { rows } = await db.query(
    'SELECT id, cluster_id FROM network_devices WHERE cluster_id = $1 LIMIT 1',
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error(`No device for cluster ${clusterId}`);

  const stored = await loadSamsungAtlasSnapshot(device.id, 'rollback');
  console.log('stored:', {
    launched_at: stored?.launched_at,
    launcher_job_id: stored?.launcher_job_id,
    session_launcher_job_id: stored?.session_launcher_job_id,
    status: stored?.status,
    stored_activity: stored?.activity?.recent?.map((e) => ({
      id: e.job_id,
      summary: e.summary,
      status: e.status,
    })),
  });

  const sessionLauncherJobId = resolveSessionLauncherId(
    stored,
    stored?.launcher_job_id,
    stored?.launcher_job_id
  );

  const live = await getSamsungPrecheckStatus({
    clusterId,
    launchedAfter: stored?.launched_at,
    launcherJobId: stored?.launcher_job_id,
    sessionLauncherJobId,
    operation: 'rollback',
    workload: stored?.workload,
  });
  live.activity = mergeSessionActivity(stored, live);

  console.log('\nlive activity:', {
    status: live.status,
    phase: live.phase,
    message: live.message,
    monitor_job_id: live.monitor_job_id,
    job_name: live.job?.name,
    job_status: live.job?.status,
    count: live.activity?.count,
    recent: live.activity?.recent?.map((e) => ({
      id: e.job_id,
      summary: e.summary,
      status: e.status,
      timestamp: e.timestamp,
    })),
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
