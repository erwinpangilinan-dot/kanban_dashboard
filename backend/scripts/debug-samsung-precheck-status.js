require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const {
  getSamsungPrecheckStatus,
  loadSamsungPrecheckSnapshot,
  fetchActivityStream,
  findWrapperJobInActivity,
  isPrecheckWrapperJobName,
  isLauncherJobName,
} = require('../src/services/network-samsung-precheck');

const clusterId = process.argv[2] || '29991573164';

(async () => {
  const { rows } = await db.query(
    'SELECT * FROM network_devices WHERE cluster_id = $1 LIMIT 1',
    [clusterId]
  );
  const device = rows[0];
  console.log('device', device?.id, device?.cluster_id);
  const stored = device ? await loadSamsungPrecheckSnapshot(device.id) : null;
  console.log('stored', JSON.stringify(stored, null, 2));

  const activity = await fetchActivityStream(clusterId);
  const entries = activity?.results || activity?.items || [];
  console.log('\nactivity (recent):');
  for (const row of entries.slice(0, 20)) {
    const name = row?.summary_fields?.job?.[0]?.name || row?.changes?.name || '';
    const status = row?.summary_fields?.job?.[0]?.status || '';
    const ts = row?.timestamp || row?.created;
    const id = row?.summary_fields?.job?.[0]?.id;
    const extra = row?.changes?.extra_vars;
    let op = '';
    if (extra) {
      try {
        const v = typeof extra === 'string' ? JSON.parse(extra) : extra;
        op = v.operation || '';
      } catch {}
    }
    console.log(ts, id, status, 'op=' + op, name);
    console.log('  launcher?', isLauncherJobName(name), 'wrapper?', isPrecheckWrapperJobName(name));
  }

  if (stored) {
    const wrapper = findWrapperJobInActivity(activity, {
      launchedAfter: stored.launched_at,
      launcherJobId: stored.launcher_job_id,
      operation: 'precheck',
    });
    console.log('\nfindWrapperJobInActivity:', wrapper);

    const status = await getSamsungPrecheckStatus({
      clusterId,
      launchedAfter: stored.launched_at,
      launcherJobId: stored.launcher_job_id,
      monitorJobId: stored.monitor_job_id,
      monitorJobKind: stored.monitor_job_kind,
      operation: 'precheck',
    });
    console.log('\nstatus', JSON.stringify(status, null, 2));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
