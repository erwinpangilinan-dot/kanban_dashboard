const db = require('../db');
const { googleFetch, isConfigured, hydrateFromDb } = require('./google-auth');
const { enrichDevicesFromMiddleware } = require('./network-subcloud-middleware');
const { writeMiddlewareFieldsToSheet } = require('./network-sheet-writeback');
const DEFAULT_SHEET_ID = '1CpfPlE12oGDIxsJJ8HoeAMXevF7nDAgRTlDoyhoWjsk';

function sheetId() {
  return process.env.NETWORK_VDU_SHEET_ID || DEFAULT_SHEET_ID;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseSheetLayout(headersRow) {
  const headers = (headersRow || []).map(normalizeHeader);
  const idx = (name) => headers.indexOf(name);

  const iCluster = headers.findIndex(
    (h) => h === 'cluster' || h === 'gnbduid' || h === 'gnbdu id'
  );
  const iIp = headers.findIndex((h) => h === 'bmc ip' || h === 'bmc_ip' || h === 'ip');
  const iOam = headers.findIndex((h) => h === 'oam ip' || h === 'oam_ip');
  const iSubcloud = headers.findIndex(
    (h) => h === 'subcloud ip' || h === 'subcloud_ip' || h === 'sub cloud ip'
  );
  const iVendor = idx('vendor');
  const iModelType = headers.findIndex((h) => h === 'model type' || h === 'model_type');
  const iModel = idx('model');
  const iApp = idx('application');
  const iClusterName = headers.findIndex(
    (h) => h === 'cluster name' || h === 'cluster_name' || h === 'clustername'
  );
  const iClusterNamespace = headers.findIndex(
    (h) =>
      h === 'cluster namespace' ||
      h === 'cluster_namespace' ||
      h === 'clusternamespace'
  );
  const iOs = idx('os');
  const iParent = headers.findIndex(
    (h) =>
      h === 'parent central controller' ||
      h === 'parent_central_controller' ||
      h === 'parent controller'
  );
  const iFuzeSite = headers.findIndex(
    (h) => h === 'fuze siteid' || h === 'fuze_siteid' || h === 'fuze site id'
  );
  const iSiteType = headers.findIndex(
    (h) => h === 'site type' || h === 'site_type' || h === 'sitetype'
  );
  const iFuzeProjectId = headers.findIndex(
    (h) =>
      h === 'fuze project id' || h === 'fuze_project_id' || h === 'fuze projectid'
  );
  const iOwner = headers.findIndex(
    (h) => h === 'owner' || h === 'site owner' || h === 'site_owner'
  );

  return {
    headers,
    iCluster,
    iIp,
    iOam,
    iSubcloud,
    iVendor,
    iModelType,
    iModel,
    iApp,
    iClusterName,
    iClusterNamespace,
    iOs,
    iParent,
    iFuzeSite,
    iSiteType,
    iFuzeProjectId,
    iOwner,
  };
}

function mapRows(values) {
  if (!values?.length) return { devices: [], layout: parseSheetLayout([]) };
  const layout = parseSheetLayout(values[0]);

  if (layout.iCluster < 0 || layout.iIp < 0) {
    throw new Error(
      'vDU_List sheet must include gNBDUID (or Cluster) and IP (or BMC IP) columns'
    );
  }

  const devices = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const cluster = String(row[layout.iCluster] || '').trim();
    const bmcIp = String(row[layout.iIp] || '').trim();
    if (!cluster || !bmcIp) continue;
    const device = {
      cluster_id: cluster,
      bmc_ip: bmcIp,
      oam_ip: layout.iOam >= 0 ? (String(row[layout.iOam] || '').trim() || null) : null,
      subcloud_ip:
        layout.iSubcloud >= 0 ? (String(row[layout.iSubcloud] || '').trim() || null) : null,
      vendor: layout.iVendor >= 0 ? (String(row[layout.iVendor] || '').trim() || null) : null,
      model_type:
        layout.iModelType >= 0 ? (String(row[layout.iModelType] || '').trim() || null) : null,
      model: layout.iModel >= 0 ? (String(row[layout.iModel] || '').trim() || null) : null,
      application: layout.iApp >= 0 ? (String(row[layout.iApp] || '').trim() || null) : null,
      cluster_name:
        layout.iClusterName >= 0 ? (String(row[layout.iClusterName] || '').trim() || null) : null,
      cluster_namespace:
        layout.iClusterNamespace >= 0
          ? (String(row[layout.iClusterNamespace] || '').trim() || null)
          : null,
      os: layout.iOs >= 0 ? (String(row[layout.iOs] || '').trim() || null) : null,
      parent_controller:
        layout.iParent >= 0 ? (String(row[layout.iParent] || '').trim() || null) : null,
      fuze_site_id:
        layout.iFuzeSite >= 0 ? (String(row[layout.iFuzeSite] || '').trim() || null) : null,
      site_type:
        layout.iSiteType >= 0 ? (String(row[layout.iSiteType] || '').trim() || null) : null,
      fuze_project_id:
        layout.iFuzeProjectId >= 0
          ? (String(row[layout.iFuzeProjectId] || '').trim() || null)
          : null,
      owner: layout.iOwner >= 0 ? (String(row[layout.iOwner] || '').trim() || null) : null,
      _sheetRow: r + 1,
      _sheetOriginal: {
        bmc_ip: bmcIp,
        subcloud_ip:
          layout.iSubcloud >= 0 ? (String(row[layout.iSubcloud] || '').trim() || '') : '',
        cluster_name:
          layout.iClusterName >= 0 ? (String(row[layout.iClusterName] || '').trim() || '') : '',
        cluster_namespace:
          layout.iClusterNamespace >= 0
            ? (String(row[layout.iClusterNamespace] || '').trim() || '')
            : '',
        parent_controller:
          layout.iParent >= 0 ? (String(row[layout.iParent] || '').trim() || '') : '',
      },
    };
    devices.push(device);
  }
  return { devices, layout };
}

async function fetchSheetValues() {
  await hydrateFromDb();
  if (!isConfigured()) {
    throw new Error('Google Workspace is not configured; cannot sync vDU_List');
  }
  const id = sheetId();
  const range = encodeURIComponent('Sheet1!A:AZ');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`;
  const data = await googleFetch(url);
  return data.values || [];
}

const SW_TAGS_CACHE_TTL_MS =
  Number(process.env.NETWORK_APPLICATION_SW_CACHE_MS) || 5 * 60_000;
let swTagsCache = null; // { tags, expiresAt, sheet }

function invalidateApplicationSwTagsCache() {
  swTagsCache = null;
}

/**
 * Read SW TAG values from the vDU_List "Application SW" tab.
 * Used as the Samsung Atlas version dropdown source.
 */
async function listApplicationSwTags({ force = false } = {}) {
  if (
    !force &&
    swTagsCache &&
    swTagsCache.expiresAt > Date.now() &&
    Array.isArray(swTagsCache.tags)
  ) {
    return swTagsCache;
  }

  await hydrateFromDb();
  if (!isConfigured()) {
    return { tags: [], sheet: null, error: 'Google Workspace is not configured' };
  }

  const id = sheetId();
  const meta = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`
  );
  const sheets = (meta.sheets || []).map((s) => s.properties).filter(Boolean);
  const appSheet = sheets.find((s) => /application\s*sw/i.test(String(s.title || '')));
  if (!appSheet?.title) {
    return { tags: [], sheet: null, error: 'Application SW sheet not found' };
  }

  const range = encodeURIComponent(`${appSheet.title}!A:Z`);
  const data = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`
  );
  const values = data.values || [];
  if (!values.length) {
    const empty = { tags: [], sheet: appSheet.title, fetched_at: new Date().toISOString() };
    swTagsCache = { ...empty, expiresAt: Date.now() + SW_TAGS_CACHE_TTL_MS };
    return empty;
  }

  const headers = (values[0] || []).map((h) =>
    String(h || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  );
  let col = headers.findIndex((h) => h === 'sw tag' || h === 'sw_tag' || h === 'swtag');
  if (col < 0) col = 0;

  const seen = new Set();
  const tags = [];
  for (let r = 1; r < values.length; r++) {
    const raw = String(values[r]?.[col] || '').trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    tags.push(raw);
  }

  const result = {
    tags,
    sheet: appSheet.title,
    fetched_at: new Date().toISOString(),
  };
  swTagsCache = { ...result, expiresAt: Date.now() + SW_TAGS_CACHE_TTL_MS };
  return result;
}

async function syncInventoryFromSheet() {
  const values = await fetchSheetValues();
  const { devices, layout } = mapRows(values);
  const middleware = await enrichDevicesFromMiddleware(devices);
  const sheet_writeback = await writeMiddlewareFieldsToSheet(devices, layout);
  invalidateApplicationSwTagsCache();
  const application_sw = await listApplicationSwTags({ force: true }).catch((err) => ({
    tags: [],
    sheet: null,
    error: err.message || String(err),
  }));
  const now = new Date();  const seen = [];

  for (const d of devices) {
    const { rows } = await db.query(
      `INSERT INTO network_devices
         (cluster_id, bmc_ip, oam_ip, subcloud_ip, vendor, model_type, model, application,
          cluster_name, cluster_namespace, os, parent_controller, fuze_site_id, site_type,
          fuze_project_id, owner, source_updated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       ON CONFLICT (cluster_id) DO UPDATE SET
         bmc_ip = EXCLUDED.bmc_ip,
         oam_ip = EXCLUDED.oam_ip,
         subcloud_ip = EXCLUDED.subcloud_ip,
         vendor = EXCLUDED.vendor,
         model_type = EXCLUDED.model_type,
         model = EXCLUDED.model,
         application = EXCLUDED.application,
         cluster_name = EXCLUDED.cluster_name,
         cluster_namespace = EXCLUDED.cluster_namespace,
         os = EXCLUDED.os,
         parent_controller = EXCLUDED.parent_controller,
         fuze_site_id = EXCLUDED.fuze_site_id,
         site_type = EXCLUDED.site_type,
         fuze_project_id = EXCLUDED.fuze_project_id,
         owner = EXCLUDED.owner,
         source_updated_at = EXCLUDED.source_updated_at,
         updated_at = EXCLUDED.updated_at
       RETURNING id, cluster_id`,
      [
        d.cluster_id,
        d.bmc_ip,
        d.oam_ip,
        d.subcloud_ip,
        d.vendor,
        d.model_type,
        d.model,
        d.application,
        d.cluster_name,
        d.cluster_namespace,
        d.os,
        d.parent_controller,
        d.fuze_site_id,
        d.site_type,
        d.fuze_project_id,
        d.owner,
        now,
      ]
    );
    seen.push(rows[0].id);
  }

  if (seen.length) {
    await db.query(
      `DELETE FROM network_devices WHERE NOT (id = ANY($1::uuid[]))`,
      [seen]
    );
  } else {
    // empty sheet — leave existing rows (avoid wipe on transient blank read)
  }

  return {
    synced: devices.length,
    sheet_id: sheetId(),
    middleware,
    sheet_writeback,
    application_sw,
  };
}

module.exports = {
  sheetId,
  parseSheetLayout,
  mapRows,
  syncInventoryFromSheet,
  listApplicationSwTags,
  invalidateApplicationSwTagsCache,
  DEFAULT_SHEET_ID,
};