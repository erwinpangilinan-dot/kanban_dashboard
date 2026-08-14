/**
 * Debug Samsung Atlas deployment status for a gNB DUID.
 * Usage: node backend/scripts/debug-samsung-deployment-status.js 29991573161
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
  fetchActivityStream,
  findWrapperJobInActivity,
  findMonitorJobViaJobsApi,
  findFailedWorkflowChildJob,
  atlasFetchDirect,
  normalizeAtlasOperation,
} = require('../src/services/network-samsung-precheck');

async function main() {
  const clusterId = process.argv[2];
  if (!clusterId) {
    console.error('Usage: node debug-samsung-deployment-status.js <gNB DUID>');
    process.exit(1);
  }

  const operation = normalizeAtlasOperation('deployment');
  const { rows } = await db.query(
    `SELECT id, cluster_id, cluster_name, application, cluster_namespace
     FROM network_devices WHERE cluster_id = $1`,
    [clusterId]
  );
  const device = rows[0];
  if (!device) {
    console.error('Device not found:', clusterId);
    process.exit(1);
  }

  console.log('Device:', device);

  const snap = await loadSamsungAtlasSnapshot(device.id, operation);
  console.log('\n--- stored deployment snapshot ---');
  console.log(
    JSON.stringify(
      {
        status: snap?.status,
        phase: snap?.phase,
        message: snap?.message,
        launcher_job_id: snap?.launcher_job_id,
        monitor_job_id: snap?.monitor_job_id,
        monitor_job_kind: snap?.monitor_job_kind,
        launched_at: snap?.launched_at,
        workload: snap?.workload,
        updated_at: snap?.updated_at,
        activity_recent: (snap?.activity?.recent || []).slice(0, 15),
      },
      null,
      2
    )
  );

  if (!snap) {
    console.log('No deployment snapshot stored.');
    return;
  }

  console.log('\n--- live Atlas workflow_job ---');
  try {
    const wf = await atlasFetchDirect(`/api/v2/workflow_jobs/${snap.launcher_job_id}/`);
    console.log(
      JSON.stringify(
        {
          id: wf?.id,
          name: wf?.name,
          status: wf?.status,
          failed: wf?.failed,
          finished: wf?.finished,
          started: wf?.started,
          elapsed: wf?.elapsed,
          job_explanation: wf?.job_explanation,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log('workflow fetch failed:', err.message);
  }

  try {
    const nodes = await atlasFetchDirect(
      `/api/v2/workflow_jobs/${snap.launcher_job_id}/workflow_nodes/?page_size=50`
    );
    console.log('\n--- workflow nodes ---');
    for (const n of nodes?.results || []) {
      const job = n?.summary_fields?.job || n?.summary_fields?.unified_job || {};
      console.log(
        [
          n?.id,
          n?.job,
          job?.status || n?.job_type,
          job?.failed ? 'failed=true' : '',
          job?.name || n?.identifier,
        ]
          .filter(Boolean)
          .join(' ')
      );
    }
  } catch (err) {
    console.log('workflow nodes fetch failed:', err.message);
  }

  const activity = await fetchActivityStream(clusterId);
  const entries = activity?.results || activity?.items || [];
  console.log('\n--- Atlas activity (recent) ---');
  for (const row of entries.slice(0, 25)) {
    const job = row?.summary_fields?.job?.[0] || row?.summary_fields?.job || {};
    const name = job?.name || row?.changes?.name || '';
    const status = job?.status || '';
    const ts = row?.timestamp || row?.created;
    const id = job?.id;
    console.log([ts, id, status, name].filter(Boolean).join(' '));
  }

  try {
    const failedChild = await findFailedWorkflowChildJob(snap.launcher_job_id);
    console.log('\n--- findFailedWorkflowChildJob ---');
    console.log(JSON.stringify(failedChild, null, 2));
  } catch (err) {
    console.log('findFailedWorkflowChildJob failed:', err.message);
  }

  const wrapper = findWrapperJobInActivity(activity, {
    launchedAfter: snap.launched_at,
    launcherJobId: snap.launcher_job_id,
    operation,
    workload: snap.workload,
  });
  console.log('\n--- findWrapperJobInActivity ---');
  console.log(JSON.stringify(wrapper, null, 2));

  const viaApi = await findMonitorJobViaJobsApi({
    clusterId,
    launcherJobId: snap.launcher_job_id,
    launcherFinishedAt: null,
    launchedAfter: snap.launched_at,
    workload: snap.workload,
    operation,
  });
  console.log('\n--- findMonitorJobViaJobsApi ---');
  console.log(JSON.stringify(viaApi, null, 2));

  console.log('\n--- live getSamsungPrecheckStatus(deployment) ---');
  const status = await getSamsungPrecheckStatus({
    clusterId: device.cluster_id,
    operation,
    launcherJobId: snap.launcher_job_id,
    monitorJobId: snap.monitor_job_id,
    monitorJobKind: snap.monitor_job_kind,
    launchedAfter: snap.launched_at,
    workload: snap.workload,
  });
  console.log(
    JSON.stringify(
      {
        phase: status.phase,
        status: status.status,
        message: status.message,
        launcher_job: status.launcher_job,
        monitor_job: status.monitor_job,
        monitor_job_id: status.monitor_job_id,
        activity_recent: (status.activity?.recent || []).slice(0, 12),
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
