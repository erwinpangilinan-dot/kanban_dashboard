const db = require('../db');
const { loadDevice } = require('./network-subcloud-precheck');

function atlasReleaseFromBuildInfo(fields) {
  if (!fields || typeof fields !== 'object') return null;
  const pkg = String(fields.PKG_VER || '').trim();
  const rel = String(fields.REL_VER || '').trim();
  if (pkg && rel) {
    const relNum = rel.replace(/^r-?/i, '');
    if (relNum) return `${pkg}-${relNum}`;
  }
  return null;
}

function displayVersionFromPodResult(podResult) {
  return (
    podResult?.software_version?.trim() ||
    podResult?.build_info?.version?.trim() ||
    podResult?.build_info?.fields?.CUS_VER?.trim() ||
    podResult?.build_info?.fields?.PAT_VER?.trim() ||
    null
  );
}

function releaseFromPodResult(podResult) {
  const fields = podResult?.build_info?.fields;
  const fromBuild = atlasReleaseFromBuildInfo(fields);
  if (fromBuild) return fromBuild;

  const display = displayVersionFromPodResult(podResult);
  if (!display) return null;

  // UDU.26A.P1.10 → best-effort; prefer PKG+REL when available
  const m = display.match(/(\d+\.[A-Z]\.\d+).*P(\d+)\.(\d+)/i);
  if (m) {
    return `${m[1]}-${m[2]}${m[3]}`;
  }
  return null;
}

function mapTrackerRow(row) {
  if (!row) return null;
  return {
    cluster_id: row.cluster_id,
    current_release: row.current_release || null,
    current_display: row.current_display || null,
    current_updated_at: row.current_updated_at || null,
    rollback_release: row.rollback_release || null,
    rollback_display: row.rollback_display || null,
    rollback_captured_at: row.rollback_captured_at || null,
    build_info: row.build_info || null,
    updated_at: row.updated_at || null,
  };
}

async function loadSamsungSoftwareTracker(deviceId) {
  const { rows } = await db.query(
    `SELECT * FROM network_samsung_software_tracker WHERE device_id = $1`,
    [deviceId]
  );
  if (!rows[0]) return null;
  return { device_id: rows[0].device_id, ...mapTrackerRow(rows[0]) };
}

async function upsertSamsungSoftwareTracker(deviceId, patch) {
  const device = await loadDevice(deviceId);
  if (!device) return null;

  const now = new Date().toISOString();
  const { rows } = await db.query(
    `INSERT INTO network_samsung_software_tracker
       (device_id, cluster_id, current_release, current_display, current_updated_at,
        rollback_release, rollback_display, rollback_captured_at, build_info, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (device_id) DO UPDATE SET
       cluster_id = EXCLUDED.cluster_id,
       current_release = COALESCE(EXCLUDED.current_release, network_samsung_software_tracker.current_release),
       current_display = COALESCE(EXCLUDED.current_display, network_samsung_software_tracker.current_display),
       current_updated_at = COALESCE(EXCLUDED.current_updated_at, network_samsung_software_tracker.current_updated_at),
       rollback_release = COALESCE(EXCLUDED.rollback_release, network_samsung_software_tracker.rollback_release),
       rollback_display = COALESCE(EXCLUDED.rollback_display, network_samsung_software_tracker.rollback_display),
       rollback_captured_at = COALESCE(EXCLUDED.rollback_captured_at, network_samsung_software_tracker.rollback_captured_at),
       build_info = COALESCE(EXCLUDED.build_info, network_samsung_software_tracker.build_info),
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      deviceId,
      device.cluster_id,
      patch.current_release ?? null,
      patch.current_display ?? null,
      patch.current_updated_at ?? null,
      patch.rollback_release ?? null,
      patch.rollback_display ?? null,
      patch.rollback_captured_at ?? null,
      patch.build_info != null ? JSON.stringify(patch.build_info) : null,
      patch.updated_at || now,
    ]
  );
  return { device_id: rows[0].device_id, ...mapTrackerRow(rows[0]) };
}

async function updateCurrentFromPodResult(deviceId, podResult) {
  if (!podResult || podResult.error) return null;

  const currentRelease = releaseFromPodResult(podResult);
  const currentDisplay = displayVersionFromPodResult(podResult);
  if (!currentRelease && !currentDisplay) return null;

  const now = new Date().toISOString();
  const device = await loadDevice(deviceId);
  if (!device) return null;

  const buildInfo = podResult.build_info?.fields || null;

  const { rows } = await db.query(
    `INSERT INTO network_samsung_software_tracker
       (device_id, cluster_id, current_release, current_display, current_updated_at, build_info, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (device_id) DO UPDATE SET
       cluster_id = EXCLUDED.cluster_id,
       current_release = COALESCE(EXCLUDED.current_release, network_samsung_software_tracker.current_release),
       current_display = COALESCE(EXCLUDED.current_display, network_samsung_software_tracker.current_display),
       current_updated_at = EXCLUDED.current_updated_at,
       build_info = COALESCE(EXCLUDED.build_info, network_samsung_software_tracker.build_info),
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      deviceId,
      device.cluster_id,
      currentRelease,
      currentDisplay,
      now,
      buildInfo ? JSON.stringify(buildInfo) : null,
      now,
    ]
  );
  return { device_id: rows[0].device_id, ...mapTrackerRow(rows[0]) };
}

async function captureRollbackBaseline(deviceId, podResult) {
  let currentRelease = releaseFromPodResult(podResult);
  let currentDisplay = displayVersionFromPodResult(podResult);
  const buildInfo = podResult?.build_info?.fields || null;

  if (!currentRelease && !currentDisplay) {
    const existing = await loadSamsungSoftwareTracker(deviceId);
    currentRelease = existing?.current_release || null;
    currentDisplay = existing?.current_display || null;
  }

  if (!currentRelease && !currentDisplay) return null;

  const now = new Date().toISOString();
  const device = await loadDevice(deviceId);
  if (!device) return null;

  const { rows } = await db.query(
    `INSERT INTO network_samsung_software_tracker
       (device_id, cluster_id, current_release, current_display, current_updated_at,
        rollback_release, rollback_display, rollback_captured_at, build_info, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (device_id) DO UPDATE SET
       cluster_id = EXCLUDED.cluster_id,
       current_release = COALESCE(EXCLUDED.current_release, network_samsung_software_tracker.current_release),
       current_display = COALESCE(EXCLUDED.current_display, network_samsung_software_tracker.current_display),
       current_updated_at = COALESCE(EXCLUDED.current_updated_at, network_samsung_software_tracker.current_updated_at),
       rollback_release = EXCLUDED.rollback_release,
       rollback_display = EXCLUDED.rollback_display,
       rollback_captured_at = EXCLUDED.rollback_captured_at,
       build_info = COALESCE(EXCLUDED.build_info, network_samsung_software_tracker.build_info),
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      deviceId,
      device.cluster_id,
      currentRelease,
      currentDisplay,
      now,
      currentRelease,
      currentDisplay,
      now,
      buildInfo ? JSON.stringify(buildInfo) : null,
      now,
    ]
  );
  return { device_id: rows[0].device_id, ...mapTrackerRow(rows[0]) };
}

async function clearRollbackBaseline(deviceId) {
  const { rowCount } = await db.query(
    `UPDATE network_samsung_software_tracker
     SET rollback_release = NULL,
         rollback_display = NULL,
         rollback_captured_at = NULL,
         updated_at = NOW()
     WHERE device_id = $1`,
    [deviceId]
  );
  return rowCount > 0;
}

function mapSamsungSoftwareTrackerRow(row) {
  if (!row?.samsung_sw_rollback_release && !row?.samsung_sw_current_release) return null;
  return {
    current_release: row.samsung_sw_current_release || null,
    current_display: row.samsung_sw_current_display || null,
    current_updated_at: row.samsung_sw_current_updated_at || null,
    rollback_release: row.samsung_sw_rollback_release || null,
    rollback_display: row.samsung_sw_rollback_display || null,
    rollback_captured_at: row.samsung_sw_rollback_captured_at || null,
    updated_at: row.samsung_sw_tracker_updated_at || null,
  };
}

function trackPodResultInBackground(deviceId, podResult) {
  if (!deviceId || !podResult || podResult.error) return;
  updateCurrentFromPodResult(deviceId, podResult).catch(() => {});
}

module.exports = {
  atlasReleaseFromBuildInfo,
  releaseFromPodResult,
  displayVersionFromPodResult,
  loadSamsungSoftwareTracker,
  upsertSamsungSoftwareTracker,
  updateCurrentFromPodResult,
  captureRollbackBaseline,
  clearRollbackBaseline,
  mapSamsungSoftwareTrackerRow,
  trackPodResultInBackground,
};
