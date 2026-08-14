const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  listVendorCredentialSettings,
  setVendorCredentials,
  getVendorCredentials,
  getWrSubcloudCredentials,
  getGlobalWrSubcloudCredentials,
  setWrSubcloudCredentials,
  listWrSubcloudControllerSettings,
  setWrSubcloudControllerCredentials,
} = require('../services/network-credentials');
const { runSyncNow, runProbeNow } = require('../services/network-poller');
const { sheetId, listApplicationSwTags } = require('../services/network-sync');
const { rebootDevice, ALLOWED_RESET_TYPES } = require('../services/network-reboot');
const { resetBmcDevice, ALLOWED_BMC_RESET_TYPES } = require('../services/network-bmc-reset');
const { precheckDevice, checkHostAgentHealth, loadDevice } = require('../services/network-subcloud-precheck');
const {
  getCustomPrecheckCommandsText,
  setCustomPrecheckCommandsFromText,
} = require('../services/network-precheck-custom');
const { listClusterPods, listDevicePods } = require('../services/network-cluster-pods');
const {
  runSamsungPrecheck,
  runSamsungUpgrade,
  runSamsungRollback,
  runSamsungUndeployment,
  runSamsungDeployment,
  getSamsungPrecheckStatus,
  loadSamsungAtlasSnapshot,
  persistSamsungAtlasStatus,
  mergeSessionActivity,
  resolveSessionLauncherId,
  cancelSamsungAtlasRun,
  mapStoredToStatusResponse,
  mapSamsungPrecheckSnapshotRow,
  mapSamsungUpgradeSnapshotRow,
  mapSamsungRollbackSnapshotRow,
  mapSamsungUndeploymentSnapshotRow,
  mapSamsungDeploymentSnapshotRow,
  atlasSettingsPublic,
  setAtlasBearerToken,
} = require('../services/network-samsung-precheck');
const { mapSamsungSoftwareTrackerRow } = require('../services/network-samsung-software-tracker');
const {
  fetchConnectionDetailsForDevice,
  connectionDetailsSettingsPublic,
} = require('../services/network-connection-details');
const {
  triggerSetupClusterForDevice,
} = require('../services/network-setup-cluster');
const {
  recordSamsungIssueFailure,
  listSamsungIssues,
  updateSamsungIssueResolution,
} = require('../services/network-samsung-issue-log');

const router = express.Router();

function requestUsername(req) {
  const name = req.user?.username;
  return typeof name === 'string' && name.trim() ? name.trim() : 'system';
}

async function recordSamsungLaunchFailure(req, operation, err) {
  try {
    const device = await loadDevice(req.params.id);
    if (!device?.cluster_id) return;
    await recordSamsungIssueFailure({
      deviceId: device.id,
      clusterId: device.cluster_id,
      siteType: device.site_type,
      operation,
      issueDescription: err?.message || `Samsung ${operation} failed`,
      userReporter: requestUsername(req),
      fallbackKey: `${device.id}:${operation}:${Date.now()}`,
    });
  } catch (logErr) {
    console.warn('[samsung-issue-log] launch catch log failed:', logErr.message);
  }
}

function mapDeviceRow(r) {
  return {
    id: r.id,
    cluster_id: r.cluster_id,
    bmc_ip: r.bmc_ip,
    oam_ip: r.oam_ip,
    subcloud_ip: r.subcloud_ip,
    cluster_name: r.cluster_name,
    cluster_namespace: r.cluster_namespace,
    os: r.os,
    parent_controller: r.parent_controller,
    fuze_site_id: r.fuze_site_id,
    site_type: r.site_type,
    fuze_project_id: r.fuze_project_id,
    owner: r.owner,
    vendor: r.vendor,
    model_type: r.model_type,
    model: r.model,
    application: r.application,
    source_updated_at: r.source_updated_at,
    snapshot: r.probed_at
      ? {
          reachable: r.reachable,
          latency_ms: r.latency_ms,
          redfish_ok: r.redfish_ok,
          health: r.health || {},
          error: r.probe_error,
          probed_at: r.probed_at,
        }
      : null,
    subcloud_snapshot: r.subcloud_probed_at
      ? {
          reachable: r.subcloud_reachable,
          latency_ms: r.subcloud_latency_ms,
          error: r.subcloud_error,
          probed_at: r.subcloud_probed_at,
        }
      : null,
    precheck_snapshot: r.precheck_checked_at
      ? {
          status: r.precheck_status,
          platform: r.precheck_platform,
          summary: r.precheck_result?.summary || null,
          checks: r.precheck_result?.checks || [],
          error: r.precheck_error,
          checked_at: r.precheck_checked_at,
          log_file: r.precheck_result?.log_file || null,
        }
      : null,
    samsung_precheck_snapshot: mapSamsungPrecheckSnapshotRow(r),
    samsung_upgrade_snapshot: mapSamsungUpgradeSnapshotRow(r),
    samsung_rollback_snapshot: mapSamsungRollbackSnapshotRow(r),
    samsung_undeployment_snapshot: mapSamsungUndeploymentSnapshotRow(r),
    samsung_deployment_snapshot: mapSamsungDeploymentSnapshotRow(r),
    samsung_software_tracker: mapSamsungSoftwareTrackerRow(r),
  };
}

const DEVICE_SELECT = `SELECT d.*,
            s.reachable,
            s.latency_ms,
            s.redfish_ok,
            s.health,
            s.error AS probe_error,
            s.probed_at,
            sc.reachable AS subcloud_reachable,
            sc.latency_ms AS subcloud_latency_ms,
            sc.error AS subcloud_error,
            sc.probed_at AS subcloud_probed_at,
            pc.status AS precheck_status,
            pc.platform AS precheck_platform,
            pc.result AS precheck_result,
            pc.error AS precheck_error,
            pc.checked_at AS precheck_checked_at,
            sp_pre.status AS samsung_precheck_status,
            sp_pre.phase AS samsung_precheck_phase,
            sp_pre.message AS samsung_precheck_message,
            sp_pre.result AS samsung_precheck_result,
            sp_pre.error AS samsung_precheck_error,
            sp_pre.launched_at AS samsung_precheck_launched_at,
            sp_pre.updated_at AS samsung_precheck_updated_at,
            sp_up.status AS samsung_upgrade_status,
            sp_up.phase AS samsung_upgrade_phase,
            sp_up.message AS samsung_upgrade_message,
            sp_up.result AS samsung_upgrade_result,
            sp_up.error AS samsung_upgrade_error,
            sp_up.launched_at AS samsung_upgrade_launched_at,
            sp_up.updated_at AS samsung_upgrade_updated_at,
            sp_rb.status AS samsung_rollback_status,
            sp_rb.phase AS samsung_rollback_phase,
            sp_rb.message AS samsung_rollback_message,
            sp_rb.result AS samsung_rollback_result,
            sp_rb.error AS samsung_rollback_error,
            sp_rb.launched_at AS samsung_rollback_launched_at,
            sp_rb.updated_at AS samsung_rollback_updated_at,
            sp_ud.status AS samsung_undeployment_status,
            sp_ud.phase AS samsung_undeployment_phase,
            sp_ud.message AS samsung_undeployment_message,
            sp_ud.result AS samsung_undeployment_result,
            sp_ud.error AS samsung_undeployment_error,
            sp_ud.launched_at AS samsung_undeployment_launched_at,
            sp_ud.updated_at AS samsung_undeployment_updated_at,
            sp_dep.status AS samsung_deployment_status,
            sp_dep.phase AS samsung_deployment_phase,
            sp_dep.message AS samsung_deployment_message,
            sp_dep.result AS samsung_deployment_result,
            sp_dep.error AS samsung_deployment_error,
            sp_dep.launched_at AS samsung_deployment_launched_at,
            sp_dep.updated_at AS samsung_deployment_updated_at,
            sw.current_release AS samsung_sw_current_release,
            sw.current_display AS samsung_sw_current_display,
            sw.current_updated_at AS samsung_sw_current_updated_at,
            sw.rollback_release AS samsung_sw_rollback_release,
            sw.rollback_display AS samsung_sw_rollback_display,
            sw.rollback_captured_at AS samsung_sw_rollback_captured_at,
            sw.updated_at AS samsung_sw_tracker_updated_at
     FROM network_devices d
     LEFT JOIN network_device_snapshots s ON s.device_id = d.id
     LEFT JOIN network_subcloud_snapshots sc ON sc.device_id = d.id
     LEFT JOIN network_subcloud_precheck_snapshots pc ON pc.device_id = d.id
     LEFT JOIN network_samsung_precheck_snapshots sp_pre
       ON sp_pre.device_id = d.id AND sp_pre.operation = 'precheck'
     LEFT JOIN network_samsung_precheck_snapshots sp_up
       ON sp_up.device_id = d.id AND sp_up.operation = 'upgrade'
     LEFT JOIN network_samsung_precheck_snapshots sp_rb
       ON sp_rb.device_id = d.id AND sp_rb.operation = 'rollback'
     LEFT JOIN network_samsung_precheck_snapshots sp_ud
       ON sp_ud.device_id = d.id AND sp_ud.operation = 'undeployment'
     LEFT JOIN network_samsung_precheck_snapshots sp_dep
       ON sp_dep.device_id = d.id AND sp_dep.operation = 'deployment'
     LEFT JOIN network_samsung_software_tracker sw ON sw.device_id = d.id`;

router.get('/devices', asyncHandler(async (_req, res) => {
  const { rows } = await db.query(`${DEVICE_SELECT} ORDER BY d.cluster_id ASC`);
  const host_agent = await checkHostAgentHealth();
  res.json({
    sheet_id: sheetId(),
    devices: rows.map(mapDeviceRow),
    host_agent,
  });
}));

router.get('/devices/:id', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`${DEVICE_SELECT} WHERE d.id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Device not found' });
  res.json(mapDeviceRow(rows[0]));
}));

router.post('/devices/:id/precheck', asyncHandler(async (req, res) => {
  try {
    const result = await precheckDevice(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Precheck failed' });
  }
}));

router.post('/devices/:id/reboot', asyncHandler(async (req, res) => {
  // PowerCycle: GracefulRestart/ForceRestart can return success on Dell iDRAC
  // while the host stays On (seen on XR8720t). PowerCycle reliably cycles power.
  const resetType = req.body?.reset_type || 'PowerCycle';
  const confirmClusterId = req.body?.confirm_cluster_id;
  if (!ALLOWED_RESET_TYPES.has(resetType)) {
    return res.status(400).json({
      error: `Unsupported reset_type. Allowed: ${[...ALLOWED_RESET_TYPES].join(', ')}`,
    });
  }
  try {
    const result = await rebootDevice(req.params.id, {
      resetType,
      confirmClusterId,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Reboot failed' });
  }
}));

router.post('/devices/:id/bmc-reset', asyncHandler(async (req, res) => {
  const resetType = req.body?.reset_type || 'GracefulRestart';
  const confirmClusterId = req.body?.confirm_cluster_id;
  if (!ALLOWED_BMC_RESET_TYPES.has(resetType)) {
    return res.status(400).json({
      error: `Unsupported reset_type. Allowed: ${[...ALLOWED_BMC_RESET_TYPES].join(', ')}`,
    });
  }
  try {
    const result = await resetBmcDevice(req.params.id, {
      resetType,
      confirmClusterId,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'BMC reset failed' });
  }
}));

router.post('/sync', asyncHandler(async (_req, res) => {
  const sync = await runSyncNow();
  const probe = await runProbeNow();
  res.json({ ...sync, ...probe });
}));

router.post('/probe', asyncHandler(async (_req, res) => {
  res.json(await runProbeNow());
}));

router.get('/pods', asyncHandler(async (_req, res) => {
  try {
    res.json(await listClusterPods());
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list cluster pods' });
  }
}));

router.get('/devices/:id/pods', asyncHandler(async (req, res) => {
  try {
    res.json(await listDevicePods(req.params.id));
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list pods' });
  }
}));

router.get('/devices/:id/connection-details', asyncHandler(async (req, res) => {
  try {
    const device = await loadDevice(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(await fetchConnectionDetailsForDevice(device));
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Connection details failed' });
  }
}));

router.post('/devices/:id/setup-cluster', asyncHandler(async (req, res) => {
  try {
    const device = await loadDevice(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(await triggerSetupClusterForDevice(device));
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Setup cluster failed' });
  }
}));

router.post('/devices/:id/samsung-precheck', asyncHandler(async (req, res) => {
  try {
    const result = await runSamsungPrecheck(req.params.id, {
      version: req.body?.version,
      confirmClusterId: req.body?.confirm_cluster_id,
      workloadOverride: req.body?.workload,
      reportedBy: requestUsername(req),
    });
    res.json(result);
  } catch (err) {
    await recordSamsungLaunchFailure(req, 'precheck', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung precheck failed' });
  }
}));

router.post('/devices/:id/samsung-upgrade', asyncHandler(async (req, res) => {
  try {
    const result = await runSamsungUpgrade(req.params.id, {
      version: req.body?.version,
      confirmClusterId: req.body?.confirm_cluster_id,
      workloadOverride: req.body?.workload,
      reportedBy: requestUsername(req),
    });
    res.json(result);
  } catch (err) {
    await recordSamsungLaunchFailure(req, 'upgrade', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung upgrade failed' });
  }
}));

router.post('/devices/:id/samsung-rollback', asyncHandler(async (req, res) => {
  try {
    const result = await runSamsungRollback(req.params.id, {
      version: req.body?.version,
      confirmClusterId: req.body?.confirm_cluster_id,
      workloadOverride: req.body?.workload,
      reportedBy: requestUsername(req),
    });
    res.json(result);
  } catch (err) {
    await recordSamsungLaunchFailure(req, 'rollback', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung rollback failed' });
  }
}));

router.post('/devices/:id/samsung-undeployment', asyncHandler(async (req, res) => {
  try {
    const result = await runSamsungUndeployment(req.params.id, {
      version: req.body?.version,
      confirmClusterId: req.body?.confirm_cluster_id,
      workloadOverride: req.body?.workload,
      reportedBy: requestUsername(req),
    });
    res.json(result);
  } catch (err) {
    await recordSamsungLaunchFailure(req, 'undeployment', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung undeployment failed' });
  }
}));

router.post('/devices/:id/samsung-deployment', asyncHandler(async (req, res) => {
  try {
    const result = await runSamsungDeployment(req.params.id, {
      version: req.body?.version,
      confirmClusterId: req.body?.confirm_cluster_id,
      workloadOverride: req.body?.workload,
      ciqSource: req.body?.ciq_source,
      reportedBy: requestUsername(req),
    });
    res.json(result);
  } catch (err) {
    await recordSamsungLaunchFailure(req, 'deployment', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung deployment failed' });
  }
}));

router.get('/samsung-issues', asyncHandler(async (req, res) => {
  const openOnly =
    req.query.open_only === '1' ||
    req.query.open_only === 'true' ||
    req.query.openOnly === '1' ||
    req.query.openOnly === 'true';
  const result = await listSamsungIssues({
    clusterId: req.query.cluster_id || null,
    operation: req.query.operation || null,
    openOnly,
    search: req.query.q || req.query.search || null,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json(result);
}));

router.patch('/samsung-issues/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!('resolved_date' in body) && !('resolution_details' in body)) {
    return res.status(400).json({
      error: 'Provide resolved_date and/or resolution_details',
    });
  }
  try {
    const issue = await updateSamsungIssueResolution(req.params.id, {
      resolvedDate: 'resolved_date' in body ? body.resolved_date : undefined,
      resolutionDetails: 'resolution_details' in body ? body.resolution_details : undefined,
    });
    res.json(issue);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to update issue' });
  }
}));

router.post('/devices/:id/samsung-upgrade/cancel', asyncHandler(async (req, res) => {
  try {
    const result = await cancelSamsungAtlasRun(req.params.id, 'upgrade', {
      reason: req.body?.reason,
      note: req.body?.note,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung upgrade cancel failed' });
  }
}));

router.post('/devices/:id/samsung-rollback/cancel', asyncHandler(async (req, res) => {
  try {
    const result = await cancelSamsungAtlasRun(req.params.id, 'rollback', {
      reason: req.body?.reason,
      note: req.body?.note,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung rollback cancel failed' });
  }
}));

router.post('/devices/:id/samsung-undeployment/cancel', asyncHandler(async (req, res) => {
  try {
    const result = await cancelSamsungAtlasRun(req.params.id, 'undeployment', {
      reason: req.body?.reason,
      note: req.body?.note,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung undeployment cancel failed' });
  }
}));

router.post('/devices/:id/samsung-deployment/cancel', asyncHandler(async (req, res) => {
  try {
    const result = await cancelSamsungAtlasRun(req.params.id, 'deployment', {
      reason: req.body?.reason,
      note: req.body?.note,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung deployment cancel failed' });
  }
}));

async function samsungAtlasStatusHandler(req, res, operation) {
  const device = await loadDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  const jobId = req.query.job_id ? Number(req.query.job_id) : null;
  const queryLauncherJobId = req.query.launcher_job_id ? Number(req.query.launcher_job_id) : null;
  const queryMonitorJobId = req.query.monitor_job_id ? Number(req.query.monitor_job_id) : null;
  const jobKind = req.query.job_kind === 'workflow_job' ? 'workflow_job' : 'job';
  const monitorJobKind = req.query.monitor_job_kind === 'workflow_job' ? 'workflow_job' : 'job';
  const stored = await loadSamsungAtlasSnapshot(device.id, operation);
  if (stored?.status === 'cancelled' && req.query.force_refresh !== '1') {
    return res.json(mapStoredToStatusResponse(stored, device));
  }
  const storedLauncherId = stored?.launcher_job_id ? Number(stored.launcher_job_id) : null;
  const effectiveLauncherJobId =
    storedLauncherId && queryLauncherJobId && storedLauncherId > queryLauncherJobId
      ? storedLauncherId
      : Number.isFinite(queryLauncherJobId) && queryLauncherJobId > 0
        ? queryLauncherJobId
        : storedLauncherId;
  const launchedAfter =
    storedLauncherId && queryLauncherJobId && storedLauncherId > queryLauncherJobId
      ? stored.launched_at
      : req.query.launched_after || stored?.launched_at || null;
  const workload = req.query.workload || stored?.workload || null;
  const effectiveMonitorJobId =
    storedLauncherId && queryLauncherJobId && storedLauncherId > queryLauncherJobId
      ? stored?.monitor_job_id ?? null
      : Number.isFinite(queryMonitorJobId) && queryMonitorJobId > 0
        ? queryMonitorJobId
        : stored?.monitor_job_id ?? null;
  const status = await getSamsungPrecheckStatus({
    clusterId: device.cluster_id,
    jobId: Number.isFinite(jobId) && jobId > 0 ? jobId : null,
    jobKind: req.query.job_kind ? jobKind : undefined,
    launchedAfter,
    launcherJobId: effectiveLauncherJobId,
    sessionLauncherJobId: resolveSessionLauncherId(
      stored,
      queryLauncherJobId,
      effectiveLauncherJobId
    ),
    monitorJobId: effectiveMonitorJobId,
    monitorJobKind: req.query.monitor_job_kind ? monitorJobKind : stored?.monitor_job_kind,
    operation,
    workload,
  });
  status.activity = mergeSessionActivity(stored, status);
  // Re-check after the Atlas round-trip: Cancel may have won while we were polling.
  const latest = await loadSamsungAtlasSnapshot(device.id, operation);
  if (latest?.status === 'cancelled' && req.query.force_refresh !== '1') {
    return res.json(mapStoredToStatusResponse(latest, device));
  }
  await persistSamsungAtlasStatus(device.id, device, status, latest || stored, operation);
  res.json(status);
}

router.get('/devices/:id/samsung-precheck/status', asyncHandler(async (req, res) => {
  try {
    await samsungAtlasStatusHandler(req, res, 'precheck');
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung precheck status failed' });
  }
}));

router.get('/devices/:id/samsung-upgrade/status', asyncHandler(async (req, res) => {
  try {
    await samsungAtlasStatusHandler(req, res, 'upgrade');
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung upgrade status failed' });
  }
}));

router.get('/devices/:id/samsung-rollback/status', asyncHandler(async (req, res) => {
  try {
    await samsungAtlasStatusHandler(req, res, 'rollback');
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung rollback status failed' });
  }
}));

router.get('/devices/:id/samsung-undeployment/status', asyncHandler(async (req, res) => {
  try {
    await samsungAtlasStatusHandler(req, res, 'undeployment');
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung undeployment status failed' });
  }
}));

router.get('/devices/:id/samsung-deployment/status', asyncHandler(async (req, res) => {
  try {
    await samsungAtlasStatusHandler(req, res, 'deployment');
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Samsung deployment status failed' });
  }
}));

router.get('/settings', asyncHandler(async (_req, res) => {
  const vendors = await listVendorCredentialSettings();
  const wrDefault = await getGlobalWrSubcloudCredentials();
  const wrControllers = await listWrSubcloudControllerSettings();
  const precheck_custom_commands = await getCustomPrecheckCommandsText();
  const applicationSw = await listApplicationSwTags().catch((err) => ({
    tags: [],
    sheet: null,
    error: err.message || String(err),
  }));
  const atlas = await atlasSettingsPublic();
  res.json({
    sheet_id: sheetId(),
    vendors: vendors.map((v) => ({
      vendor: v.vendor,
      username: v.username || '',
      password_set: v.password_set,
    })),
    wr_subcloud: {
      username: wrDefault.username || '',
      password_set: Boolean(wrDefault.password),
      key_path_set: Boolean(wrDefault.keyPath),
      configured: wrDefault.configured,
    },
    wr_subcloud_controllers: wrControllers,
    precheck_custom_commands,
    precheck_log_dir: 'logs/subcloud-precheck',
    atlas: {
      ...atlas,
      sw_tags: applicationSw.tags || [],
      sw_tags_sheet: applicationSw.sheet || null,
      default_sw_tag:
        (atlas.default_version &&
          (applicationSw.tags || []).includes(atlas.default_version) &&
          atlas.default_version) ||
        (applicationSw.tags || [])[0] ||
        atlas.default_version ||
        '',
    },
    middleware: connectionDetailsSettingsPublic(),
  });
}));

router.post('/settings', asyncHandler(async (req, res) => {
  if (req.body?.scope === 'atlas_bearer') {
    const token = req.body?.bearer_token ?? req.body?.token;
    if (token == null || String(token).trim() === '') {
      return res.status(400).json({ error: 'bearer_token required' });
    }
    const saved = await setAtlasBearerToken(token);
    const atlas = await atlasSettingsPublic();
    return res.json({
      scope: 'atlas_bearer',
      ...saved,
      atlas,
    });
  }

  if (req.body?.scope === 'precheck_custom') {
    const text = req.body?.commands;
    if (text == null) {
      return res.status(400).json({ error: 'commands text required' });
    }
    const commands = await setCustomPrecheckCommandsFromText(text);
    return res.json({
      scope: 'precheck_custom',
      count: commands.length,
      precheck_custom_commands: await getCustomPrecheckCommandsText(),
      precheck_log_dir: 'logs/subcloud-precheck',
    });
  }

  if (req.body?.scope === 'wr_subcloud_controller') {
    const controller = req.body?.controller;
    const username = req.body?.username;
    const password = req.body?.password;
    if (!controller?.trim()) {
      return res.status(400).json({ error: 'controller required' });
    }
    if (username == null && (password == null || password === '')) {
      return res.status(400).json({ error: 'username or password required' });
    }
    const creds = await setWrSubcloudControllerCredentials(controller, { username, password });
    const controllers = await listWrSubcloudControllerSettings();
    return res.json({
      scope: 'wr_subcloud_controller',
      controller: controller.trim(),
      username: creds.username,
      password_set: Boolean(creds.password),
      configured: creds.configured,
      wr_subcloud_controllers: controllers,
    });
  }

  if (req.body?.scope === 'wr_subcloud') {
    const username = req.body?.username;
    const password = req.body?.password;
    if (username == null && (password == null || password === '')) {
      return res.status(400).json({ error: 'username or password required' });
    }
    const wr = await setWrSubcloudCredentials({ username, password });
    return res.json({
      scope: 'wr_subcloud',
      username: wr.username,
      password_set: Boolean(wr.password),
      key_path_set: Boolean(wr.keyPath),
      configured: wr.configured,
    });
  }

  const vendor = req.body?.vendor || 'DELL';
  const username = req.body?.username;
  const password = req.body?.password;
  if (username == null && (password == null || password === '')) {
    return res.status(400).json({ error: 'username or password required' });
  }
  await setVendorCredentials(vendor, { username, password });
  const creds = await getVendorCredentials(vendor);
  res.json({
    vendor: String(vendor).toUpperCase(),
    username: creds.username,
    password_set: Boolean(creds.password),
    configured: creds.configured,
  });
}));

module.exports = router;
