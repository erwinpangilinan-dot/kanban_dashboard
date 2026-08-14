require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const {
  fetchActivityStream,
  getSamsungPrecheckStatus,
  findWrapperJobInActivity,
  findWorkflowJobInActivity,
  loadSamsungAtlasSnapshot,
  atlasFetchDirect,
} = require('../src/services/network-samsung-precheck');

const clusterId = process.argv[2] || '29991573163';

(async () => {
  const { rows } = await db.query(
    'SELECT id, cluster_id FROM network_devices WHERE cluster_id = $1 LIMIT 1',
    [clusterId]
  );
  const device = rows[0];
  if (!device) throw new Error(`No device for ${clusterId}`);

  const stored = await loadSamsungAtlasSnapshot(device.id, 'rollback');
  console.log('rollback snapshot:', {
    launched_at: stored?.launched_at,
    launcher_job_id: stored?.launcher_job_id,
    workload: stored?.workload,
    status: stored?.status,
    message: stored?.message,
  });

  const activity = await fetchActivityStream(clusterId);
  const entries = activity?.results || activity?.items || [];
  console.log('\ntotal activity entries:', entries.length);

  console.log('\nlast 15 activity entries (unfiltered):');
  for (const row of entries.slice(0, 15)) {
    const ts = row?.timestamp || row?.created;
    const name = row?.summary_fields?.job?.[0]?.name || row?.changes?.name || '';
    const status = row?.summary_fields?.job?.[0]?.status || '';
    const id = row?.summary_fields?.job?.[0]?.id;
    console.log(ts, `job#${id}`, status, name);
  }

  const afterMs = stored?.launched_at
    ? new Date(stored.launched_at).getTime() - 15_000
    : 0;
  console.log('\nentries since rollback launch:');
  for (const row of entries) {
    const ts = row?.timestamp || row?.created;
    const tms = ts ? new Date(ts).getTime() : 0;
    if (afterMs && tms && tms < afterMs) continue;

    const name = row?.summary_fields?.job?.[0]?.name || row?.changes?.name || '';
    const status = row?.summary_fields?.job?.[0]?.status || '';
    const id = row?.summary_fields?.job?.[0]?.id;
    let op = '';
    const extra = row?.changes?.extra_vars;
    if (extra) {
      try {
        op = (typeof extra === 'string' ? JSON.parse(extra) : extra).operation || '';
      } catch {
        /* ignore */
      }
    }
    console.log(ts, `job#${id}`, status, `op=${op}`, name);
  }

  const workload = stored?.workload || 'VDU';
  const wrapper = findWrapperJobInActivity(activity, {
    launchedAfter: stored?.launched_at,
    launcherJobId: stored?.launcher_job_id,
    launcherFinishedAt: stored?.job?.finished || stored?.launcher_job?.finished,
    operation: 'rollback',
    workload,
  });
  console.log('\nfindWrapperJobInActivity:', wrapper);

  for (const statuses of [['running', 'pending'], ['success'], ['failed']]) {
    const wf = findWorkflowJobInActivity(activity, {
      launchedAfter: stored?.launched_at,
      launcherFinishedAt: stored?.job?.finished || stored?.launcher_job?.finished,
      launcherJobId: stored?.launcher_job_id,
      statuses,
      workload,
      operation: 'rollback',
    });
    console.log(`findWorkflowJobInActivity (${statuses.join(',')}):`, wf?.name, wf?.ref?.id);
  }

  const live = await getSamsungPrecheckStatus({
    clusterId,
    launchedAfter: stored?.launched_at,
    launcherJobId: stored?.launcher_job_id,
    monitorJobId: stored?.monitor_job_id,
    monitorJobKind: stored?.monitor_job_kind,
    operation: 'rollback',
    workload,
  });
  console.log('\nlive:', {
    status: live.status,
    phase: live.phase,
    message: live.message,
    monitor_job_id: live.monitor_job_id,
    job_name: live.job?.name,
    activity_count: live.activity?.count,
    activity_recent: live.activity?.recent?.map((e) => ({
      job_id: e.job_id,
      status: e.status,
      summary: e.summary,
    })),
  });

  if (stored?.launcher_job_id) {
    const launcher = await atlasFetchDirect(`/api/v2/jobs/${stored.launcher_job_id}/`);
    console.log('\nlauncher job:', {
      id: launcher.id,
      name: launcher.name,
      status: launcher.status,
      started: launcher.started,
      finished: launcher.finished,
    });
    const vars = launcher.extra_vars;
    let parsed = {};
    try {
      parsed = typeof vars === 'string' ? JSON.parse(vars) : vars || {};
    } catch {
      /* ignore */
    }
    console.log('launcher extra_vars operation:', parsed.operation);
    console.log('launcher summary_fields:', JSON.stringify(launcher.summary_fields || {}).slice(0, 300));

    try {
      const related = await atlasFetchDirect(
        `/api/v2/jobs/?job_template__name__icontains=FOA&order_by=-finished&page_size=10`
      );
      console.log('\nrecent FOA jobs (global):');
      for (const j of related.results || []) {
        if (String(j.name || '').includes('29991573163') || j.id >= stored.launcher_job_id - 5) {
          console.log(j.finished, j.id, j.status, j.name);
        }
      }
    } catch (err) {
      console.log('recent jobs query failed:', err.message);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
