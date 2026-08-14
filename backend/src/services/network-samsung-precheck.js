const db = require('../db');
const { writeEnvValues } = require('../lib/env-file');
const { loadDevice } = require('./network-subcloud-precheck');
const { listDevicePods } = require('./network-cluster-pods');
const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');
const {
  loadSamsungSoftwareTracker,
  captureRollbackBaseline,
  clearRollbackBaseline,
} = require('./network-samsung-software-tracker');
const { recordSamsungIssueFailure } = require('./network-samsung-issue-log');
const {
  failureDetailScore,
  isMoreSpecificFailure,
  shouldPreferNestedJob,
  analyzeAtlasFailureWithOllama,
} = require('./network-samsung-failure-analysis');

const UDU_TEMPLATE = Number(process.env.NETWORK_ATLAS_UDU_TEMPLATE_ID) || 7491;
const VDU_TEMPLATE = Number(process.env.NETWORK_ATLAS_VDU_TEMPLATE_ID) || 6578;
const UDU_UNDEPLOY_TEMPLATE =
  Number(process.env.NETWORK_ATLAS_UDU_UNDEPLOY_TEMPLATE_ID) || 5666;
const VDU_UNDEPLOY_TEMPLATE =
  Number(process.env.NETWORK_ATLAS_VDU_UNDEPLOY_TEMPLATE_ID) || 10237;
const UDU_DEPLOY_TEMPLATE = Number(process.env.NETWORK_ATLAS_UDU_DEPLOY_TEMPLATE_ID) || 8784;
const VDU_DEPLOY_TEMPLATE = Number(process.env.NETWORK_ATLAS_VDU_DEPLOY_TEMPLATE_ID) || 6746;

const ATLAS_BEARER_SETTINGS_KEY = 'network_atlas_bearer_token';
const ATLAS_BEARER_CACHE_MS = 10_000;

let cachedToken = null;
let cachedTokenExpires = 0;
let cachedSessionCookie = null;
let cachedSessionExpires = 0;
/** @type {{ value: string|null|undefined, at: number }} */
let atlasBearerCache = { value: undefined, at: 0 };

function atlasBaseUrl() {
  return (process.env.NETWORK_ATLAS_BASE_URL || 'http://me.atlas.automation.vzwnet.com').replace(
    /\/$/,
    ''
  );
}

function envAtlasBearerToken() {
  return (
    process.env.NETWORK_ATLAS_BEARER_TOKEN?.trim() ||
    process.env.NETWORK_ATLAS_TOKEN?.trim() ||
    null
  );
}

async function loadStoredAtlasBearerToken() {
  const { rows } = await db.query('SELECT value FROM workspace_settings WHERE key = $1', [
    ATLAS_BEARER_SETTINGS_KEY,
  ]);
  const value = rows[0]?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function resolveAtlasBearerToken({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    atlasBearerCache.value !== undefined &&
    now - atlasBearerCache.at < ATLAS_BEARER_CACHE_MS
  ) {
    return atlasBearerCache.value || envAtlasBearerToken();
  }
  try {
    const stored = await loadStoredAtlasBearerToken();
    atlasBearerCache = { value: stored, at: now };
    return stored || envAtlasBearerToken();
  } catch {
    atlasBearerCache = { value: null, at: now };
    return envAtlasBearerToken();
  }
}

/** Sync fallback for rare call sites; prefer resolveAtlasBearerToken(). */
function atlasBearerToken() {
  if (atlasBearerCache.value) return atlasBearerCache.value;
  return envAtlasBearerToken();
}

async function setAtlasBearerToken(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed || trimmed === '********') {
    const err = new Error('bearer_token required');
    err.status = 400;
    throw err;
  }
  await db.query(
    `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [ATLAS_BEARER_SETTINGS_KEY, trimmed]
  );
  process.env.NETWORK_ATLAS_BEARER_TOKEN = trimmed;
  writeEnvValues({ NETWORK_ATLAS_BEARER_TOKEN: trimmed });
  atlasBearerCache = { value: trimmed, at: Date.now() };
  return {
    bearer_token_set: true,
    auth_mode: 'bearer',
    configured: true,
    env_written: true,
  };
}

function atlasAuthConfigured() {
  if (atlasBearerToken()) return true;
  const username = process.env.NETWORK_ATLAS_USERNAME?.trim();
  const password = process.env.NETWORK_ATLAS_PASSWORD;
  return Boolean(username && password != null && password !== '');
}

async function atlasAuthConfiguredAsync() {
  if (await resolveAtlasBearerToken()) return true;
  const username = process.env.NETWORK_ATLAS_USERNAME?.trim();
  const password = process.env.NETWORK_ATLAS_PASSWORD;
  return Boolean(username && password != null && password !== '');
}

function atlasAuth() {
  if (atlasBearerToken()) {
    const err = new Error(
      'Atlas is configured with NETWORK_ATLAS_BEARER_TOKEN — username/password auth is not used'
    );
    err.status = 400;
    throw err;
  }
  const username = process.env.NETWORK_ATLAS_USERNAME?.trim();
  const password = process.env.NETWORK_ATLAS_PASSWORD;
  if (!username || password == null || password === '') {
    const err = new Error(
      'Atlas not configured — set NETWORK_ATLAS_BEARER_TOKEN in Network Settings (or .env), or NETWORK_ATLAS_USERNAME and NETWORK_ATLAS_PASSWORD'
    );
    err.status = 400;
    throw err;
  }
  return { username, password };
}

function batchUsername() {
  return (
    process.env.NETWORK_ATLAS_BATCH_USERNAME?.trim() ||
    process.env.NETWORK_ATLAS_USERNAME?.trim() ||
    'dashboard'
  );
}

function atlasLoginUsername() {
  const configured = process.env.NETWORK_ATLAS_AUTH_USERNAME?.trim();
  if (configured) return configured;
  const { username } = atlasAuth();
  const domain = process.env.NETWORK_ATLAS_DOMAIN?.trim();
  if (domain) return `${domain}\\${username}`;
  return username;
}

function basicAuthHeader() {
  const { password } = atlasAuth();
  return `Basic ${Buffer.from(`${atlasLoginUsername()}:${password}`).toString('base64')}`;
}

function atlasTemplateForWorkload(workload) {
  if (workload === 'UDU') return UDU_TEMPLATE;
  if (workload === 'VDU') return VDU_TEMPLATE;
  return null;
}

function atlasUndeployTemplateForWorkload(workload) {
  if (workload === 'UDU') return UDU_UNDEPLOY_TEMPLATE;
  if (workload === 'VDU') return VDU_UNDEPLOY_TEMPLATE;
  return null;
}

function atlasDeployTemplateForWorkload(workload) {
  if (workload === 'UDU') return UDU_DEPLOY_TEMPLATE;
  if (workload === 'VDU') return VDU_DEPLOY_TEMPLATE;
  return null;
}

// Atlas rejects anything outside this set, so validate before launching rather
// than letting the workflow fail on a typo.
const ATLAS_CIQ_SOURCES = ['MARKET_PLACE', 'CONQUEST_LAB'];

function defaultCiqSource() {
  const configured = process.env.NETWORK_ATLAS_DEPLOY_CIQ_SOURCE?.trim().toUpperCase();
  return ATLAS_CIQ_SOURCES.includes(configured) ? configured : ATLAS_CIQ_SOURCES[0];
}

function normalizeCiqSource(value) {
  if (value == null || String(value).trim() === '') return defaultCiqSource();
  const normalized = String(value).trim().toUpperCase();
  if (!ATLAS_CIQ_SOURCES.includes(normalized)) {
    const err = new Error(
      `Invalid ciqSource "${value}". Expected one of: ${ATLAS_CIQ_SOURCES.join(', ')}.`
    );
    err.status = 400;
    throw err;
  }
  return normalized;
}

function buildUndeploymentPayload(clusterId, version, fuzeProjectId) {
  const extra_vars = {
    gnbDuId: String(clusterId).trim(),
    version: String(version).trim(),
    ciqSource: 'MARKET_PLACE',
    method: 'Orchestrator',
  };
  if (fuzeProjectId) extra_vars.fuzeProjectId = String(fuzeProjectId).trim();
  return { extra_vars };
}

function buildDeploymentPayload(clusterId, version, fuzeProjectId, ciqSource) {
  const extra_vars = {
    gnbDuId: String(clusterId).trim(),
    version: String(version).trim(),
    ciqSource: normalizeCiqSource(ciqSource),
    method: 'Orchestrator',
  };
  if (fuzeProjectId) extra_vars.fuzeProjectId = String(fuzeProjectId).trim();
  return { extra_vars };
}

function detectSamsungWorkload(pods, clusterId) {
  const names = (pods || []).map((p) => String(p.name || '').toLowerCase());
  if (names.some((n) => n.includes('uadpf'))) return 'UDU';
  if (names.some((n) => /(?:^|[^a-z])adpf/.test(n) || n.startsWith('adpf'))) return 'VDU';
  const id = String(clusterId || '').trim();
  if (id && names.some((n) => n.includes(`uadpf${id}`))) return 'UDU';
  if (id && names.some((n) => n.includes(`adpf${id}`))) return 'VDU';
  return null;
}

function detectSamsungWorkloadFromHints({
  pods,
  clusterId,
  softwareVersion,
  buildInfo,
  modelType,
  siteType,
} = {}) {
  const fromPods = detectSamsungWorkload(pods, clusterId);
  if (fromPods) return { workload: fromPods, source: 'pods' };

  const st = String(siteType || '').toUpperCase();
  if (/\bUDU\b/.test(st)) return { workload: 'UDU', source: 'site_type' };
  if (/\bVDU\b/.test(st)) return { workload: 'VDU', source: 'site_type' };

  const versionHints = [
    softwareVersion,
    buildInfo?.version,
    buildInfo?.fields?.CUS_VER,
    buildInfo?.fields?.PAT_VER,
    buildInfo?.fields?.SW_NAME,
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (/\bUDU\b/.test(versionHints) || /SVR\d+AUDU/.test(versionHints)) {
    return { workload: 'UDU', source: 'software_version' };
  }
  if (/\bVDU\b/.test(versionHints) || /SVR\d+AVDU/.test(versionHints)) {
    return { workload: 'VDU', source: 'software_version' };
  }

  const mt = String(modelType || '').toUpperCase();
  if (mt.includes('UDU')) return { workload: 'UDU', source: 'model_type' };
  if (mt.includes('VDU')) return { workload: 'VDU', source: 'model_type' };

  return null;
}

function normalizeWorkload(value) {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'UDU' || v === 'VDU') return v;
  return null;
}

function isSamsungApplication(device) {
  return String(device.application || '')
    .trim()
    .toLowerCase()
    .includes('samsung');
}

function formatScheduledRunDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function normalizeAtlasOperation(operation) {
  const op = String(operation || 'precheck').trim().toLowerCase();
  if (op === 'upgrade' || op === 'rollback' || op === 'undeployment' || op === 'deployment') return op;
  return 'precheck';
}

function isAtlasMultiStepOperation(operation) {
  const op = normalizeAtlasOperation(operation);
  return op === 'upgrade' || op === 'rollback' || op === 'undeployment' || op === 'deployment';
}

// Deployment and undeployment both launch Atlas workflow_job_templates (not
// batch job_templates) and are monitored via child workflow step names rather
// than a single upgrade/rollback wrapper job.
function isAtlasWorkflowOperation(operation) {
  const op = normalizeAtlasOperation(operation);
  return op === 'undeployment' || op === 'deployment';
}

function workflowFieldNames(operation) {
  const op = normalizeAtlasOperation(operation);
  return op === 'deployment'
    ? { workflow: 'deployWorkflow', terminal: 'deployTerminal', launcher: 'deployLauncher' }
    : { workflow: 'undeployWorkflow', terminal: 'undeployTerminal', launcher: 'undeployLauncher' };
}

function buildAtlasBatchPayload(clusterId, version, operation = 'precheck') {
  const op = normalizeAtlasOperation(operation);
  const batchOp = op === 'upgrade' ? 'upgrade' : op === 'rollback' ? 'rollback' : 'precheck';
  return {
    extra_vars: {
      batch_list: [
        {
          userName: batchUsername(),
          batch_id: '1',
          batch_priority: 1,
          scheduled_run_date: formatScheduledRunDate(),
          operation: batchOp,
          version: String(version).trim(),
          gnblist: [String(clusterId).trim()],
        },
      ],
    },
  };
}

function buildPrecheckPayload(clusterId, version) {
  return buildAtlasBatchPayload(clusterId, version, 'precheck');
}

function shouldUseAtlasViaHost() {
  return (
    process.env.NETWORK_ATLAS_VIA_HOST === '1' ||
    (process.env.NETWORK_ATLAS_VIA_HOST !== '0' && process.env.NETWORK_PRECHECK_VIA_HOST === '1')
  );
}

function formatAtlasErrorBody(json) {
  if (json == null) return null;
  if (typeof json === 'string' && json.trim()) return json.trim();
  if (typeof json !== 'object') return String(json);

  // Host-agent wrapper: { error, atlas: <AWX body> }
  if (json.atlas && typeof json.atlas === 'object') {
    const nested = formatAtlasErrorBody(json.atlas);
    if (nested) return nested;
  }

  if (json.detail) return String(json.detail);
  if (json.error && typeof json.error === 'string') return json.error;
  if (json.raw && typeof json.raw === 'string' && json.raw.trim()) return json.raw.trim();

  // AWX/Tower survey validation often returns { field: ["msg", ...] } with no detail.
  // Prefer the human messages from variables_needed_to_start when present.
  if (Array.isArray(json.variables_needed_to_start) && json.variables_needed_to_start.length) {
    return json.variables_needed_to_start
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .filter(Boolean)
      .join(' | ');
  }

  const parts = [];
  for (const [key, value] of Object.entries(json)) {
    if (key === 'atlas' || key === 'error' || key === 'detail' || key === 'raw') continue;
    if (key === 'variables_needed_to_start') continue;
    if (Array.isArray(value)) {
      const msgs = value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).filter(Boolean);
      if (msgs.length) parts.push(`${key}: ${msgs.join('; ')}`);
    } else if (typeof value === 'string' && value.trim()) {
      parts.push(`${key}: ${value.trim()}`);
    }
  }
  return parts.length ? parts.join(' | ') : null;
}

function atlasAuthErrorMessage(json, status) {
  const detail = formatAtlasErrorBody(json) || `Atlas HTTP ${status}`;
  if (status === 401 || String(detail).toLowerCase().includes('authentication')) {
    if (atlasBearerToken()) {
      return `Atlas bearer token rejected — update NETWORK_ATLAS_BEARER_TOKEN in Network Settings. ${detail}`;
    }
    return `Atlas authentication failed — update NETWORK_ATLAS_BEARER_TOKEN in Network Settings, or verify NETWORK_ATLAS_USERNAME/PASSWORD (escape $ as $$ in Compose). ${detail}`;
  }
  return detail;
}

async function atlasFetchViaHost(path, { method = 'GET', body } = {}) {
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${base}/atlas${path}`, {
      method,
      headers: hostAgentHeaders({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(atlasAuthErrorMessage(json, res.status));
      err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
      err.atlas = json.atlas && typeof json.atlas === 'object' ? json.atlas : json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function acquireAtlasToken() {
  if (cachedToken && Date.now() < cachedTokenExpires) return cachedToken;

  const res = await fetch(`${atlasBaseUrl()}/api/v2/tokens/`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: `dashboard-samsung-precheck-${Date.now()}`,
      application: null,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(atlasAuthErrorMessage(json, res.status));
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.atlas = json;
    throw err;
  }
  if (!json.token) {
    const err = new Error('Atlas token response missing token field');
    err.status = 502;
    err.atlas = json;
    throw err;
  }
  cachedToken = json.token;
  cachedTokenExpires = Date.now() + 25 * 60 * 1000;
  return cachedToken;
}

async function acquireAtlasSessionCookie() {
  if (cachedSessionCookie && Date.now() < cachedSessionExpires) return cachedSessionCookie;

  const { password } = atlasAuth();
  const username = atlasLoginUsername();
  const attempts = [
    {
      path: '/api/login/',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }).toString(),
    },
    {
      path: '/api/v2/login/',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(`${atlasBaseUrl()}${attempt.path}`, {
        method: 'POST',
        headers: attempt.headers,
        body: attempt.body,
        redirect: 'manual',
      });
      const setCookie = res.headers.get('set-cookie');
      if (!setCookie) continue;
      const cookies = setCookie
        .split(/,(?=[^;]+=)/)
        .map((part) => part.split(';')[0].trim())
        .filter(Boolean);
      if (!cookies.length) continue;
      cachedSessionCookie = cookies.join('; ');
      cachedSessionExpires = Date.now() + 20 * 60 * 1000;
      return cachedSessionCookie;
    } catch {
      /* try next login path */
    }
  }

  const err = new Error('Atlas session login failed');
  err.status = 401;
  throw err;
}

async function atlasFetchDirect(path, { method = 'GET', body, authMode = 'auto' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const bearer = await resolveAtlasBearerToken();

  async function attempt(mode) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    };
    if (mode === 'bearer') {
      headers.Authorization = `Bearer ${bearer}`;
    } else if (mode === 'token') {
      headers.Authorization = `Bearer ${await acquireAtlasToken()}`;
    } else if (mode === 'session') {
      headers.Cookie = await acquireAtlasSessionCookie();
    } else {
      headers.Authorization = basicAuthHeader();
    }
    const res = await fetch(`${atlasBaseUrl()}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { res, json };
  }

  function authFailed(res, json) {
    return (
      res.status === 401 ||
      res.status === 403 ||
      String(json.detail || '').toLowerCase().includes('authentication')
    );
  }

  try {
    const modes =
      authMode === 'auto'
        ? bearer
          ? ['bearer']
          : ['basic', 'token', 'session']
        : [authMode === 'bearer' || authMode === 'token' ? authMode : 'basic'];
    let last = null;
    for (const mode of modes) {
      try {
        last = await attempt(mode);
      } catch (err) {
        if (mode === modes[modes.length - 1]) throw err;
        continue;
      }
      if (!authFailed(last.res, last.json)) break;
      cachedToken = null;
      cachedTokenExpires = 0;
      cachedSessionCookie = null;
      cachedSessionExpires = 0;
    }
    const { res, json } = last || { res: { status: 502 }, json: {} };
    if (!res.ok) {
      const err = new Error(atlasAuthErrorMessage(json, res.status));
      err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
      err.atlas = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function atlasFetch(path, { method = 'GET', body, authMode = 'auto' } = {}) {
  if (shouldUseAtlasViaHost()) {
    return atlasFetchViaHost(path, { method, body });
  }
  return atlasFetchDirect(path, { method, body, authMode });
}

const ATLAS_TERMINAL_STATUSES = new Set(['successful', 'failed', 'error', 'canceled', 'cancelled']);

function parseLaunchJobRef(launch) {
  if (!launch || typeof launch !== 'object') return null;
  const type = String(launch.type || '').toLowerCase();

  if (launch.workflow_job != null) {
    const id = Number(launch.workflow_job);
    if (Number.isFinite(id) && id > 0) return { id, kind: 'workflow_job' };
  }

  if (type.includes('workflow')) {
    const id = Number(launch.id);
    if (Number.isFinite(id) && id > 0) return { id, kind: 'workflow_job' };
  }

  const jobId = Number(launch.job ?? launch.job_id);
  if (Number.isFinite(jobId) && jobId > 0) {
    return { id: jobId, kind: 'job' };
  }

  const launchId = Number(launch.id);
  if (Number.isFinite(launchId) && launchId > 0) {
    return { id: launchId, kind: type.includes('workflow') ? 'workflow_job' : 'job' };
  }

  return null;
}

function parseLaunchJobId(launch) {
  return parseLaunchJobRef(launch)?.id ?? null;
}

async function launchAtlasJob(workload, payload) {
  const templateId = atlasTemplateForWorkload(workload);
  return atlasFetch(`/api/v2/job_templates/${templateId}/launch/`, {
    method: 'POST',
    body: payload,
  });
}

async function launchAtlasWorkflowJob(templateId, payload) {
  return atlasFetch(`/api/v2/workflow_job_templates/${templateId}/launch/`, {
    method: 'POST',
    body: payload,
  });
}

async function launchPrecheckJob(workload, payload) {
  return launchAtlasJob(workload, payload);
}

async function fetchAtlasJobRef(ref) {
  const primary =
    ref.kind === 'workflow_job'
      ? `/api/v2/workflow_jobs/${ref.id}/`
      : `/api/v2/jobs/${ref.id}/`;
  try {
    const job = await atlasFetch(primary);
    return { job, kind: ref.kind };
  } catch (err) {
    const fallback =
      ref.kind === 'workflow_job'
        ? `/api/v2/jobs/${ref.id}/`
        : `/api/v2/workflow_jobs/${ref.id}/`;
    try {
      const job = await atlasFetch(fallback);
      return {
        job,
        kind: ref.kind === 'workflow_job' ? 'job' : 'workflow_job',
      };
    } catch {
      throw err;
    }
  }
}

async function fetchActivityStream(clusterId) {
  const q = encodeURIComponent(String(clusterId).trim());
  return atlasFetch(`/api/v2/activity_stream/?search=${q}`);
}

function summarizeJob(job, kind = 'job') {
  const raw = String(job?.status || '').toLowerCase();
  let status;
  if (raw === 'successful') {
    status = job?.finished ? 'success' : 'running';
  } else if (['failed', 'error'].includes(raw) || job?.failed) {
    status = 'failed';
  } else if (['canceled', 'cancelled'].includes(raw)) {
    status = 'failed';
  } else if (raw === 'running') {
    status = 'running';
  } else if (['pending', 'waiting', 'new'].includes(raw)) {
    status = 'pending';
  } else if (job?.started && !job?.finished) {
    status = 'running';
  } else {
    status = 'unknown';
  }

  return {
    job_id: job?.id ?? null,
    job_kind: kind,
    name: job?.name || null,
    status,
    raw_status: job?.status || null,
    started: job?.started || null,
    finished: job?.finished || null,
    elapsed: job?.elapsed ?? null,
    failed: Boolean(job?.failed),
    job_explanation: job?.job_explanation || job?.result_traceback || null,
    terminal: ATLAS_TERMINAL_STATUSES.has(raw) && Boolean(job?.finished || ['failed', 'error', 'canceled', 'cancelled'].includes(raw)),
  };
}

function parseJobUrl(url) {
  const m = String(url || '').match(/\/(jobs|workflow_jobs)\/(\d+)\/?$/);
  if (!m) return null;
  return { kind: m[1] === 'workflow_jobs' ? 'workflow_job' : 'job', id: Number(m[2]) };
}

function activityRowTimestamp(row) {
  return row?.timestamp || row?.created || null;
}

function activityJobName(row) {
  return row?.summary_fields?.job?.[0]?.name || row?.changes?.name || '';
}

function isLauncherJobName(name) {
  return /launcher/i.test(String(name || ''));
}

const ATLAS_MONITOR = {
  UDU: {
    launcher: /(?:ME )?uADPF Launcher Bulk uDU Upgrade API/i,
    precheckWrapper: /uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck/i,
    // UDU upgrade completes on the postcheck/postcheck wrapper (same playbook name as precheck).
    upgradeTerminal: /uADPF Wrapper Bulk uDU Upgrade Precheck Postcheck/i,
    upgradeWorkflow: [
      /Direct Samsung Change Version/i,
      /VCPFE - Upgrade Workflow uADPF/i,
      /uADPF Wrapper Bulk uDU/i,
      /CAAS_update/i,
    ],
    upgradeExclude: [/spoofcheck disable/i, /PaaS - Wrapper Kubeconfig/i],
    undeployWorkflow: [
      /Samsung UADPF Zero Touch Undeployment/i,
      /Zero Touch Undeployment/i,
      /PRECHECK-\s*UADPF - Samsung - New Repo/i,
      /GROW - UADPF - Samsung - New Repo/i,
      /DAY0 ACTION - UADPF - Samsung - New Repo/i,
      /uADPF Wrapper Bulk uDU Data Refresh/i,
      /uADPF Launcher Bulk uDU Data Refresh/i,
    ],
    undeployTerminal: /VERIFICATION - UADPF - Samsung - New Repo \(SI Team\)/i,
    undeployLauncher: /Samsung UADPF Zero Touch Undeployment/i,
    deployWorkflow: [
      /Samsung UADPF Zero Touch Deployment/i,
      /Zero Touch Deployment/i,
      /PRECHECK-\s*UADPF - Samsung - New Repo/i,
      /GROW - UADPF - Samsung - New Repo/i,
      /DAY0 ACTION - UADPF - Samsung - New Repo/i,
      /uADPF Wrapper Bulk uDU Data Refresh/i,
      /uADPF Launcher Bulk uDU Data Refresh/i,
    ],
    deployTerminal: /uADPF Launcher Bulk uDU Deployment Precheck Postcheck \(SI Team\)/i,
    deployLauncher: /Samsung UADPF Zero Touch Deployment/i,
  },
  VDU: {
    launcher: /FOA Launcher Bulk vDU Upgrade API/i,
    precheckWrapper: /FOA Wrapper Bulk vDU Upgrade Precheck Postcheck/i,
    // VDU rollback/upgrade completes on the postcheck wrapper (Direct Samsung is intermediate).
    upgradeTerminal: /FOA Wrapper Bulk vDU Upgrade Precheck Postcheck/i,
    upgradeWorkflow: [
      /Direct Samsung Change Version/i,
      /VCPFE - CAAS_update/i,
      /FOA Wrapper Bulk vDU Upgrade/i,
    ],
    upgradeExclude: [/spoofcheck disable/i, /PaaS - Wrapper Kubeconfig/i],
    undeployWorkflow: [
      /FOA ONLY Samsung vDU ZeroTouch Undeployment/i,
      /ZeroTouch Undeployment/i,
      /FOA ONLY Samsung vDU Precheck/i,
      /FOA ONLY Samsung vDU Grow/i,
      /FOA ONLY Samsung vDU Deployment/i,
    ],
    undeployTerminal: /FOA ONLY Samsung vDU Verification/i,
    undeployLauncher: /FOA ONLY Samsung vDU ZeroTouch Undeployment/i,
    deployWorkflow: [
      /FOA Samsung vDU ZeroTouch Deployment/i,
      /ZeroTouch Deployment/i,
      /FOA ONLY Samsung vDU Precheck/i,
      /FOA ONLY Samsung vDU Grow/i,
      /FOA ONLY Samsung vDU Deployment/i,
    ],
    deployTerminal: /FOA Launcher Bulk vDU Deployment Precheck Postcheck/i,
    deployLauncher: /FOA Samsung vDU ZeroTouch Deployment/i,
  },
};

function atlasMonitorConfig(workload) {
  const w = normalizeWorkload(workload);
  return w ? ATLAS_MONITOR[w] : null;
}

function atlasMonitorPatterns(workload) {
  const cfg = atlasMonitorConfig(workload);
  if (!cfg) return null;
  return { launcher: cfg.launcher, wrapper: cfg.precheckWrapper };
}

function isUpgradeNoiseJobName(name, workload) {
  const cfg = atlasMonitorConfig(workload);
  const n = String(name || '');
  if (!cfg) return /PaaS - Wrapper Kubeconfig/i.test(n);
  return cfg.upgradeExclude.some((re) => re.test(n));
}

function isAtlasWorkflowLauncherName(name, workload, operation) {
  const op = normalizeAtlasOperation(operation);
  const cfg = atlasMonitorConfig(workload);
  const n = String(name || '');
  const { launcher } = workflowFieldNames(op);
  if (cfg?.[launcher]?.test(n)) return true;
  return op === 'deployment' ? /Zero ?Touch Deployment/i.test(n) : /Zero ?Touch Undeployment/i.test(n);
}

function jobBelongsToAtlasSession(job, { clusterId, launcherJobId, workload, operation } = {}) {
  const op = normalizeAtlasOperation(operation);
  if (!isAtlasWorkflowOperation(op)) {
    return jobExtraVarsContainsCluster(job, clusterId);
  }

  const jobId = Number(job?.id);
  const launcherId = Number(launcherJobId);
  if (!Number.isFinite(jobId) || !Number.isFinite(launcherId)) {
    return jobExtraVarsContainsCluster(job, clusterId);
  }
  if (jobId === launcherId) return true;
  if (jobId > launcherId && jobId <= launcherId + 500) {
    const name = job?.name || '';
    const rowWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
    if (
      isMonitorJobCandidate(name, rowWorkload, op) ||
      isAtlasWorkflowLauncherName(name, rowWorkload, op)
    ) {
      return true;
    }
  }
  return jobExtraVarsContainsCluster(job, clusterId);
}

function monitorCandidateRank(entry, workload, operation) {
  const op = normalizeAtlasOperation(operation);
  const isTerminal = isAtlasUpgradeTerminalJobName(entry.name, workload, op);
  const statusRank = { failed: 4, running: 3, pending: 2, success: 1, unknown: 0 };
  let rank = statusRank[entry.entryStatus] ?? 0;
  if (isAtlasWorkflowOperation(op) && !isTerminal && entry.entryStatus === 'failed') {
    rank = 2;
  }
  if (isTerminal) rank += 10;
  return rank;
}

function isAtlasUpgradeWorkflowJobName(name, workload, operation) {
  const op = normalizeAtlasOperation(operation);
  const n = String(name || '');
  if (isUpgradeNoiseJobName(n, workload)) return false;
  if (isAtlasLauncherJobName(n, workload)) return false;
  const cfg = atlasMonitorConfig(workload);
  if (isAtlasWorkflowOperation(op)) {
    const { workflow, terminal } = workflowFieldNames(op);
    if (!cfg) {
      return op === 'deployment'
        ? /Zero ?Touch Deployment/i.test(n)
        : /Zero Touch Undeployment|ZeroTouch Undeployment/i.test(n);
    }
    if (cfg[terminal].test(n)) return true;
    return cfg[workflow].some((re) => re.test(n));
  }
  if (!isAtlasMultiStepOperation(op)) return false;
  if (!cfg) return /Direct Samsung Change Version|CAAS_update/i.test(n);
  if (cfg.upgradeTerminal.test(n)) return true;
  return cfg.upgradeWorkflow.some((re) => re.test(n));
}

function isAtlasUpgradeTerminalJobName(name, workload, operation) {
  const op = normalizeAtlasOperation(operation);
  const cfg = atlasMonitorConfig(workload);
  const n = String(name || '');
  if (isAtlasWorkflowOperation(op)) {
    const { terminal } = workflowFieldNames(op);
    if (!cfg) {
      return op === 'deployment'
        ? /uADPF Launcher Bulk uDU Deployment Precheck Postcheck \(SI Team\)/i.test(n) ||
            /FOA Launcher Bulk vDU Deployment Precheck Postcheck/i.test(n)
        : /VERIFICATION - UADPF - Samsung - New Repo \(SI Team\)/i.test(n) ||
            /FOA ONLY Samsung vDU Verification/i.test(n);
    }
    return cfg[terminal].test(n);
  }
  if (!isAtlasMultiStepOperation(op)) return false;
  if (!cfg) return /Direct Samsung Change Version/i.test(n);
  return cfg.upgradeTerminal.test(n);
}

function isIntermediateUpgradeSuccess(name, workload, operation) {
  const op = normalizeAtlasOperation(operation);
  if (!isAtlasMultiStepOperation(op)) return false;
  // The Zero Touch workflow/launcher job itself is not an "intermediate" step.
  if (isAtlasWorkflowLauncherName(name, workload, op)) return false;
  return (
    isAtlasUpgradeWorkflowJobName(name, workload, op) &&
    !isAtlasUpgradeTerminalJobName(name, workload, op)
  );
}

function atlasWrapperPattern(workload, operation) {
  const cfg = atlasMonitorConfig(workload);
  const op = normalizeAtlasOperation(operation);
  if (!cfg) return null;
  if (op === 'precheck') return cfg.precheckWrapper;
  if (isAtlasWorkflowOperation(op)) return cfg[workflowFieldNames(op).terminal];
  if (isAtlasMultiStepOperation(op)) return cfg.upgradeTerminal;
  return cfg.precheckWrapper;
}

function inferWorkloadFromJobName(name) {
  const n = String(name || '');
  if (ATLAS_MONITOR.VDU.launcher.test(n) || ATLAS_MONITOR.VDU.precheckWrapper.test(n)) return 'VDU';
  if (ATLAS_MONITOR.UDU.launcher.test(n) || ATLAS_MONITOR.UDU.precheckWrapper.test(n)) return 'UDU';
  if (ATLAS_MONITOR.VDU.undeployWorkflow.some((re) => re.test(n))) return 'VDU';
  if (ATLAS_MONITOR.UDU.undeployWorkflow.some((re) => re.test(n))) return 'UDU';
  if (ATLAS_MONITOR.VDU.deployWorkflow.some((re) => re.test(n))) return 'VDU';
  if (ATLAS_MONITOR.UDU.deployWorkflow.some((re) => re.test(n))) return 'UDU';
  if (/vDU/i.test(n)) return 'VDU';
  if (/uDU/i.test(n)) return 'UDU';
  return null;
}

function isAtlasLauncherJobName(name, workload) {
  const patterns = atlasMonitorPatterns(workload);
  if (patterns?.launcher.test(String(name || ''))) return true;
  return isLauncherJobName(name);
}

function isAtlasWrapperJobName(name, workload, operation = 'precheck') {
  const op = normalizeAtlasOperation(operation);
  const n = String(name || '');
  const pattern = atlasWrapperPattern(workload, op);
  if (pattern?.test(n)) return true;
  if (op === 'precheck') return isPrecheckWrapperJobName(n);
  return false;
}

function isPrecheckWrapperJobName(name) {
  const n = String(name || '');
  return (
    /precheck|postcheck/i.test(n) &&
    /wrapper/i.test(n) &&
    !isLauncherJobName(n) &&
    !/spoofcheck/i.test(n) &&
    !/PaaS - Wrapper Kubeconfig/i.test(n)
  );
}

function parseExtraVars(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function atlasWrapperOperations(operation) {
  if (operation === 'upgrade') return ['postcheck', 'upgrade'];
  if (operation === 'rollback') return ['rollback', 'postcheck'];
  return ['precheck'];
}

function extraVarsOperationMatches(vars, operation) {
  if (!operation) return true;
  const op = String(vars?.operation || '').toLowerCase();
  if (!op) return operation !== 'precheck';
  return atlasWrapperOperations(operation).includes(op);
}

function rowMatchesOperation(row, operation) {
  if (!operation) return true;
  const extra = row?.changes?.extra_vars;
  if (!extra) return true;
  return extraVarsOperationMatches(parseExtraVars(extra), operation);
}

// Atlas clocks and our launch timestamp can drift slightly, so allow a small
// grace window before deciding a job predates the run.
const RUN_START_GRACE_MS = 15_000;

/**
 * True when a job started or finished before the run was launched, which means
 * it belongs to an earlier run of the same operation on the same device.
 */
function jobPredatesRun(job, launchedAfter) {
  if (!launchedAfter) return false;
  const afterMs = new Date(launchedAfter).getTime() - RUN_START_GRACE_MS;
  if (!Number.isFinite(afterMs)) return false;
  if (job?.started && new Date(job.started).getTime() < afterMs) return true;
  if (job?.finished && new Date(job.finished).getTime() < afterMs) return true;
  return false;
}

function jobBelongsToAtlasRun(job, { launchedAfter, launcherJobId, operation, workload, clusterId } = {}) {
  const name = job?.name || '';
  const effectiveWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
  const op = normalizeAtlasOperation(operation);
  if (isAtlasLauncherJobName(name, effectiveWorkload)) return false;
  const monitorJob =
    isAtlasWrapperJobName(name, effectiveWorkload, op) ||
    (isAtlasMultiStepOperation(op) && isAtlasUpgradeWorkflowJobName(name, effectiveWorkload, op));
  if (!monitorJob) return false;

  if (jobPredatesRun(job, launchedAfter)) return false;

  const vars = parseExtraVars(job?.extra_vars);
  if (launcherJobId && vars.launcher_job_id) {
    const terminalUpgrade =
      isAtlasMultiStepOperation(op) &&
      isAtlasUpgradeTerminalJobName(name, effectiveWorkload, op);
    if (!terminalUpgrade && String(vars.launcher_job_id) !== String(launcherJobId)) {
      if (
        isAtlasWorkflowOperation(op) &&
        jobBelongsToAtlasSession(job, {
          clusterId,
          launcherJobId,
          workload: effectiveWorkload,
          operation: op,
        })
      ) {
        /* session-scoped workflow (deploy/undeploy) child */
      } else if (!(clusterId && jobExtraVarsContainsCluster(job, clusterId))) {
        return false;
      }
    }
  } else if (
    isAtlasWorkflowOperation(op) &&
    launcherJobId &&
    !jobBelongsToAtlasSession(job, {
      clusterId,
      launcherJobId,
      workload: effectiveWorkload,
      operation: op,
    })
  ) {
    return false;
  }
  if (vars.operation) {
    const workflowByName =
      isAtlasMultiStepOperation(op) && isAtlasUpgradeWorkflowJobName(name, effectiveWorkload, op);
    if (!workflowByName) {
      return extraVarsOperationMatches(vars, operation);
    }
  }
  return true;
}

function rowMatchesLauncher(row, launcherJobId) {
  if (!launcherJobId) return true;
  const extra = row?.changes?.extra_vars;
  if (!extra) return true;
  try {
    const vars = typeof extra === 'string' ? JSON.parse(extra) : extra;
    if (!vars.launcher_job_id) return true;
    return String(vars.launcher_job_id) === String(launcherJobId);
  } catch {
    return true;
  }
}

function extractActivityJobRef(row) {
  const sfJob = row?.summary_fields?.job?.[0];
  if (sfJob?.id) {
    return { kind: 'job', id: Number(sfJob.id), info: sfJob };
  }
  const sfWorkflow = row?.summary_fields?.workflow_job;
  const workflowInfo = Array.isArray(sfWorkflow) ? sfWorkflow[0] : sfWorkflow;
  if (workflowInfo?.id) {
    return { kind: 'workflow_job', id: Number(workflowInfo.id), info: workflowInfo };
  }
  for (const url of [
    ...(row?.related?.job || []),
    ...(row?.related?.workflow_job ? [row.related.workflow_job].flat() : []),
  ]) {
    const ref = parseJobUrl(url);
    if (ref) return { ...ref, info: sfJob || workflowInfo || null };
  }
  return null;
}

function findWrapperJobInActivity(
  activity,
  { launchedAfter, launcherJobId, launcherFinishedAt, operation, workload } = {}
) {
  const entries = activity?.results || activity?.items || [];
  const afterMs = launchedAfter ? new Date(launchedAfter).getTime() - 15_000 : 0;
  const launcherAfterMs = launcherFinishedAt
    ? new Date(launcherFinishedAt).getTime() - 5_000
    : afterMs;
  const candidates = [];

  for (const row of entries) {
    const ts = activityRowTimestamp(row);
    if (afterMs && ts && new Date(ts).getTime() < afterMs) continue;
    if (launcherAfterMs && ts && new Date(ts).getTime() < launcherAfterMs) continue;

    const name = activityJobName(row);
    const rowWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
    const op = normalizeAtlasOperation(operation);
    const wrapperMatch = isAtlasWrapperJobName(name, rowWorkload, op);
    const workflowMatch =
      isAtlasMultiStepOperation(op) && isAtlasUpgradeWorkflowJobName(name, rowWorkload, op);
    if (!wrapperMatch && !workflowMatch) continue;
    if (launcherJobId && !rowMatchesLauncher(row, launcherJobId)) continue;
    if (!rowMatchesOperation(row, operation)) continue;

    const ref = extractActivityJobRef(row);
    if (!ref?.id) continue;

    const entryStatus = activityEntryStatus(row);
    if (
      isAtlasMultiStepOperation(op) &&
      entryStatus === 'success' &&
      isIntermediateUpgradeSuccess(name, rowWorkload, op)
    ) {
      continue;
    }

    candidates.push({
      ref: { kind: ref.kind, id: ref.id },
      name: ref.info?.name || name,
      raw_status: ref.info?.status || null,
      timestamp: ts,
    });
  }

  candidates.sort((a, b) => {
    const aTerminal = isAtlasUpgradeTerminalJobName(a.name, workload, operation) ? 1 : 0;
    const bTerminal = isAtlasUpgradeTerminalJobName(b.name, workload, operation) ? 1 : 0;
    if (aTerminal !== bTerminal) return bTerminal - aTerminal;
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  });
  return candidates[0] || null;
}

function jobExtraVarsContainsCluster(job, clusterId) {
  const cid = String(clusterId || '').trim();
  if (!cid) return true;
  const vars = parseExtraVars(job?.extra_vars);
  const fromBatch = (vars.batch_list || []).flatMap((b) => b?.gnblist || []);
  const lists = [vars.gnblist, vars.gnb_list, vars.gnbDuId, fromBatch].flat().filter(Boolean);
  if (lists.some((g) => String(g).trim() === cid)) return true;
  return String(job?.extra_vars || '').includes(cid);
}

function jobApiEntryStatus(job) {
  const rawStatus = String(job?.status || '').toLowerCase();
  if (rawStatus === 'successful') return job?.finished ? 'success' : 'running';
  if (['failed', 'error'].includes(rawStatus) || job?.failed) return 'failed';
  if (rawStatus === 'running') return 'running';
  if (['pending', 'waiting', 'new'].includes(rawStatus)) return 'pending';
  if (job?.started && !job?.finished) return 'running';
  return 'unknown';
}

function isMonitorJobCandidate(name, workload, operation) {
  const rowWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
  const op = normalizeAtlasOperation(operation);
  const wrapperMatch = isAtlasWrapperJobName(name, rowWorkload, op);
  const workflowMatch =
    isAtlasMultiStepOperation(op) && isAtlasUpgradeWorkflowJobName(name, rowWorkload, op);
  return wrapperMatch || workflowMatch;
}

async function findMonitorJobViaJobsApi({
  clusterId,
  launcherJobId,
  launcherFinishedAt,
  launchedAfter,
  workload,
  operation,
} = {}) {
  if (!clusterId || !launcherJobId) return null;

  // Use the earlier of the two hints: for multi-node workflow jobs (e.g. this
  // undeployment workflow), child step jobs can start *before* the parent
  // workflow job reports "finished", so bounding solely by launcherFinishedAt
  // can incorrectly exclude them.
  const candidateBounds = [
    launcherFinishedAt ? new Date(launcherFinishedAt).getTime() - 5_000 : null,
    launchedAfter ? new Date(launchedAfter).getTime() - 15_000 : null,
  ].filter((v) => Number.isFinite(v));
  const afterMs = candidateBounds.length ? Math.min(...candidateBounds) : 0;
  const op = normalizeAtlasOperation(operation);
  const candidates = [];

  for (let page = 1; page <= 4; page += 1) {
    let data;
    try {
      data = await atlasFetch(
        `/api/v2/jobs/?id__gte=${launcherJobId}&order_by=id&page=${page}&page_size=50`
      );
    } catch {
      break;
    }
    const results = data?.results || [];
    if (!results.length) break;

    for (const job of results) {
      if (Number(job.id) === Number(launcherJobId)) continue;
      if (!jobBelongsToAtlasSession(job, { clusterId, launcherJobId, workload, operation: op })) continue;

      const started = job?.started || job?.created;
      if (afterMs && started && new Date(started).getTime() < afterMs) continue;

      const name = job?.name || '';
      if (!isMonitorJobCandidate(name, workload, op)) continue;

      const vars = parseExtraVars(job?.extra_vars);
      const rowWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
      if (
        vars.operation &&
        !extraVarsOperationMatches(vars, op) &&
        !isAtlasUpgradeWorkflowJobName(name, rowWorkload, op)
      ) {
        continue;
      }

      const entryStatus = jobApiEntryStatus(job);
      if (
        isAtlasMultiStepOperation(op) &&
        entryStatus === 'success' &&
        isIntermediateUpgradeSuccess(name, workload, op)
      ) {
        continue;
      }

      candidates.push({
        ref: { kind: 'job', id: Number(job.id) },
        name,
        raw_status: job.status,
        timestamp: started,
        entryStatus,
      });
    }

    if (!data?.next) break;
  }

  candidates.sort((a, b) => {
    const aRank = monitorCandidateRank(a, workload, op);
    const bRank = monitorCandidateRank(b, workload, op);
    if (aRank !== bRank) return bRank - aRank;
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  });

  return candidates[0] || null;
}

function activityEntryFromJobSummary(summary, prefix = 'jobs-api') {
  if (!summary?.job_id) return null;
  return {
    id: `${prefix}-${summary.job_id}`,
    timestamp: summary.started || summary.finished || null,
    summary: summary.name || `Job #${summary.job_id}`,
    status: summary.status || 'unknown',
    operation: null,
    job_id: summary.job_id,
    job_kind: summary.job_kind || 'job',
  };
}

function ensureLauncherInActivityEntries(entries, launcherJobSummary, launcherJobId) {
  const id = Number(launcherJobId);
  if (!id || !launcherJobSummary?.job_id) return entries;
  if (entries.some((e) => Number(e.job_id) === id)) return entries;
  const launcherEntry = activityEntryFromJobSummary(launcherJobSummary);
  if (!launcherEntry) return entries;
  return [...entries, launcherEntry].sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );
}

const ACTIVITY_RECENT_LIMIT = 12;

function isSameAtlasSession(stored, status) {
  if (!stored?.launched_at || !status?.launched_at) return false;
  return String(stored.launched_at) === String(status.launched_at);
}

function mergeSessionActivity(stored, status) {
  if (!stored?.activity?.recent?.length) return status.activity;
  if (!isSameAtlasSession(stored, status)) return status.activity;

  const sessionId = Number(
    status?.session_launcher_job_id ||
      status?.launcher_job_id ||
      stored?.session_launcher_job_id ||
      stored?.launcher_job_id
  );
  let storedActivity = stored.activity;
  if (Number.isFinite(sessionId) && sessionId > 0 && Array.isArray(storedActivity.recent)) {
    storedActivity = {
      ...storedActivity,
      recent: storedActivity.recent.filter((row) => {
        const jobId = Number(row?.job_id);
        if (Number.isFinite(jobId) && jobId > 0 && jobId < sessionId) return false;
        return true;
      }),
    };
  }
  return mergeActivitySummaries(status.activity, storedActivity);
}

function resolveSessionLauncherId(stored, queryLauncherId, effectiveLauncherId) {
  const positive = (id) => Number.isFinite(Number(id)) && Number(id) > 0;
  const storedSession = positive(stored?.session_launcher_job_id)
    ? Number(stored.session_launcher_job_id)
    : null;

  // Atlas job ids increase, so a launcher newer than the stored anchor means a
  // fresh run was started. Carrying the previous session forward here is what
  // makes status keep reporting the earlier run's outcome.
  const explicit = [queryLauncherId, effectiveLauncherId].filter(positive).map(Number);
  const newestExplicit = explicit.length ? Math.max(...explicit) : null;
  if (newestExplicit && (!storedSession || newestExplicit > storedSession)) {
    return newestExplicit;
  }
  if (storedSession) return storedSession;

  // Within one session the launcher has the lowest id, since Atlas creates the
  // child jobs after it.
  const candidates = [
    queryLauncherId,
    stored?.launcher_job_id,
    effectiveLauncherId,
    ...(stored?.activity?.recent || []).map((entry) => entry.job_id),
  ]
    .filter(positive)
    .map(Number);
  return candidates.length ? Math.min(...candidates) : null;
}

async function listClusterJobsFromJobsApi({
  clusterId,
  launcherJobId,
  minJobId,
  launchedAfter,
  workload,
  operation,
  includeLauncher = true,
} = {}) {
  if (!clusterId || !launcherJobId) return [];

  const newestId = Number(launcherJobId);
  const sessionId = Number(minJobId);
  const queryFromId =
    sessionId > 0 && sessionId < newestId
      ? sessionId
      : launchedAfter
        ? Math.max(1, newestId - 500)
        : newestId;
  const op = normalizeAtlasOperation(operation);
  const afterMs = launchedAfter
    ? new Date(launchedAfter).getTime() - atlasSessionLookbackMs(op)
    : 0;
  const entries = [];

  for (let page = 1; page <= 4; page += 1) {
    let data;
    try {
      data = await atlasFetch(
        `/api/v2/jobs/?id__gte=${queryFromId}&order_by=id&page=${page}&page_size=50`
      );
    } catch {
      break;
    }
    const results = data?.results || [];
    if (!results.length) break;

    for (const job of results) {
      const jobId = Number(job.id);
      const name = job?.name || '';
      const rowWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
      const isAnyLauncher = isAtlasLauncherJobName(name, rowWorkload);
      if (!includeLauncher && isAnyLauncher && jobId === Number(launcherJobId)) continue;
      if (
        !isAnyLauncher &&
        !jobBelongsToAtlasSession(job, { clusterId, launcherJobId, workload, operation: op })
      ) {
        continue;
      }

      const started = job?.started || job?.created;
      if (afterMs && started && new Date(started).getTime() < afterMs) continue;

      if (isAnyLauncher) {
        /* include every launcher step in this session */
      } else if (!isMonitorJobCandidate(name, rowWorkload, op)) {
        continue;
      } else {
        const vars = parseExtraVars(job?.extra_vars);
        if (
          vars.operation &&
          !extraVarsOperationMatches(vars, op) &&
          !isAtlasUpgradeWorkflowJobName(name, rowWorkload, op)
        ) {
          continue;
        }
      }

      entries.push({
        id: `jobs-api-${jobId}`,
        timestamp: started || job?.finished || null,
        summary: name,
        status: jobApiEntryStatus(job),
        operation: parseExtraVars(job?.extra_vars)?.operation || null,
        job_id: jobId,
        job_kind: 'job',
      });
    }

    if (!data?.next) break;
  }

  return entries.sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );
}

function summarizeJobsApiActivity(entries, clusterId) {
  const recent = entries.slice(0, ACTIVITY_RECENT_LIMIT);
  let status = 'unknown';
  if (recent.some((r) => r.status === 'running')) status = 'running';
  else if (recent.some((r) => r.status === 'pending')) status = 'pending';
  else if (recent.some((r) => r.status === 'failed')) status = 'failed';
  else if (recent.some((r) => r.status === 'success')) status = 'success';
  else if (recent.length) status = 'pending';

  return {
    cluster_id: clusterId,
    status,
    count: entries.length,
    recent,
    source: 'jobs_api',
  };
}

function mergeActivitySummaries(primary, fallback) {
  if (!fallback?.recent?.length) return primary;
  if (!primary?.recent?.length) {
    return {
      ...fallback,
      cluster_id: primary?.cluster_id || fallback.cluster_id,
      error: primary?.error,
    };
  }

  const seen = new Set(primary.recent.map((row) => `${row.job_id || row.id}`));
  const mergedRecent = [...primary.recent];
  for (const row of fallback.recent) {
    const key = `${row.job_id || row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mergedRecent.push(row);
  }
  mergedRecent.sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );

  let status = primary.status;
  if (status === 'unknown' && fallback.status !== 'unknown') status = fallback.status;
  else if (fallback.status === 'running') status = 'running';
  else if (fallback.status === 'failed' && status !== 'running') status = 'failed';

  return {
    cluster_id: primary.cluster_id || fallback.cluster_id,
    status,
    count: Math.max(primary.count || 0, fallback.count || 0, mergedRecent.length),
    recent: mergedRecent.slice(0, ACTIVITY_RECENT_LIMIT),
    error: primary.error,
  };
}

async function enrichActivityFromJobsApi(activitySummary, {
  clusterId,
  launcherJobId,
  minJobId,
  launcherJobSummary,
  launchedAfter,
  workload,
  operation,
} = {}) {
  if (!clusterId || !launcherJobId) return activitySummary;

  try {
    let entries = await listClusterJobsFromJobsApi({
      clusterId,
      launcherJobId,
      minJobId,
      launchedAfter,
      workload,
      operation,
      includeLauncher: true,
    });
    entries = ensureLauncherInActivityEntries(entries, launcherJobSummary, launcherJobId);
    if (!entries.length) return activitySummary;
    const jobsApiActivity = summarizeJobsApiActivity(entries, clusterId);
    return mergeActivitySummaries(activitySummary, jobsApiActivity);
  } catch (err) {
    if (!activitySummary?.error) {
      return { ...activitySummary, jobs_api_error: err.message };
    }
    return activitySummary;
  }
}

async function findLatestLauncherJobForCluster({ clusterId, workload, minLauncherJobId = 0 } = {}) {
  if (!clusterId) return null;
  const minId = Number(minLauncherJobId) || 0;
  try {
    const data = await atlasFetch(
      `/api/v2/jobs/?id__gt=${minId}&order_by=-id&page_size=50`
    );
    for (const job of data.results || []) {
      if (!jobExtraVarsContainsCluster(job, clusterId)) continue;
      const rowWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(job.name);
      if (!isAtlasLauncherJobName(job.name, rowWorkload)) continue;
      return {
        id: Number(job.id),
        name: job.name,
        started: job.started || job.created,
        finished: job.finished,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function isWorkflowIntermediateJobName(name, workload, operation = 'precheck') {
  const effectiveWorkload = normalizeWorkload(workload) || inferWorkloadFromJobName(name);
  const n = String(name || '');
  const op = normalizeAtlasOperation(operation);
  if (isUpgradeNoiseJobName(n, effectiveWorkload)) return false;
  if (isAtlasLauncherJobName(n, effectiveWorkload)) return false;
  if (isAtlasWrapperJobName(n, effectiveWorkload, op)) return false;
  if (isAtlasMultiStepOperation(op) && isAtlasUpgradeWorkflowJobName(n, effectiveWorkload, op)) {
    return true;
  }
  return Boolean(n.trim());
}

function findWorkflowJobInActivity(
  activity,
  { launchedAfter, launcherFinishedAt, launcherJobId, statuses = ['failed'], workload, operation = 'precheck' } = {}
) {
  const entries = activity?.results || activity?.items || [];
  const afterMs = launchedAfter ? new Date(launchedAfter).getTime() - 15_000 : 0;
  const launcherAfterMs = launcherFinishedAt
    ? new Date(launcherFinishedAt).getTime() - 5_000
    : afterMs;
  const want = new Set(statuses);
  const candidates = [];

  for (const row of entries) {
    const ts = activityRowTimestamp(row);
    if (afterMs && ts && new Date(ts).getTime() < afterMs) continue;
    if (launcherAfterMs && ts && new Date(ts).getTime() < launcherAfterMs) continue;

    const name = activityJobName(row);
    if (!isWorkflowIntermediateJobName(name, workload, operation)) continue;

    const entryStatus = activityEntryStatus(row);
    if (!want.has(entryStatus)) continue;

    if (want.has('success') && !isAtlasUpgradeTerminalJobName(name, workload, operation)) {
      continue;
    }

    if (launcherJobId && rowMatchesLauncher(row, launcherJobId)) {
      /* linked to this launcher */
    }

    const ref = extractActivityJobRef(row);
    if (!ref?.id) continue;

    candidates.push({
      ref: { kind: ref.kind, id: ref.id },
      name: ref.info?.name || name,
      raw_status: ref.info?.status || entryStatus,
      timestamp: ts,
      entryStatus,
    });
  }

  candidates.sort((a, b) => {
    if (want.has('success')) {
      const aTerminal = isAtlasUpgradeTerminalJobName(a.name, workload, operation) ? 1 : 0;
      const bTerminal = isAtlasUpgradeTerminalJobName(b.name, workload, operation) ? 1 : 0;
      if (aTerminal !== bTerminal) return bTerminal - aTerminal;
    }
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  });
  return candidates[0] || null;
}

function extractFailureDetailFromStdout(stdout) {
  let content = stdout?.content ?? stdout?.result?.content ?? '';
  if (typeof content !== 'string' || !content.trim()) return null;
  content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');

  const lines = content.split('\n');

  // Helm / CNF deploy root causes often appear inside DAY0 wrapper logs as
  // escaped JSON, not as the outer Ansible fatal. Prefer them first.
  const HELM_PATTERNS = [
    /helm install failed with error -\s*Error: INSTALLATION FAILED:[^\n]{0,240}/i,
    /Error: INSTALLATION FAILED:[^\n"\\]{0,240}/i,
    /cannot re-use a name that is still in use/i,
    /helm install failed[^\n]{0,240}/i,
  ];
  for (const pattern of HELM_PATTERNS) {
    const match = content.match(pattern);
    if (match?.[0]) {
      return sanitizeAtlasErrorDetail(
        match[0]
          .trim()
          .replace(/\\+"?\s*\}?\s*$/g, '')
          .replace(/"+$/g, '')
          .trim()
      );
    }
  }

  // These lines name the upstream call that actually failed, so they beat the
  // generic Ansible "fatal:" wrapper. Ranked most specific first: a summary
  // line already contains the status code, while the per-attempt retry lines
  // repeat it once per attempt and would otherwise crowd it out.
  const ROOT_CAUSE_PATTERNS = [
    /Error occurred during API launch request/i,
    /Max number of retries reached/i,
    /\b[45]\d{2} Client Error\b.*\bfor url\b/i,
  ];
  for (const pattern of ROOT_CAUSE_PATTERNS) {
    // One match is enough: each of these lines already carries the URL and the
    // status code, and later repeats tend to be the same text embedded in JSON.
    const matched = lines.map((line) => line.trim()).find((line) => pattern.test(line));
    if (matched) return sanitizeAtlasErrorDetail(matched);
  }

  const hits = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/PermissionError:/i.test(trimmed)) hits.push(trimmed);
    if (/fatal: \[[^\]]+\]: (FAILED|UNREACHABLE)!/i.test(trimmed)) {
      // Skip fatals with empty msg — they hide nested Helm/API causes.
      if (/"msg"\s*:\s*""/.test(trimmed) && /failed_when_result/i.test(trimmed)) continue;
      hits.push(trimmed);
    }
    if (/Validation Failure/i.test(trimmed)) hits.push(trimmed);
    if (/^\*\*\* FAILED/i.test(trimmed) || /^TASK \[.*\] \*\*\* FAILED/i.test(trimmed)) {
      hits.push(trimmed);
    }
  }
  if (hits.length) {
    const ranked = [...new Set(hits)].sort(
      (a, b) => failureDetailScore(b) - failureDetailScore(a)
    );
    return sanitizeAtlasErrorDetail(ranked.slice(0, 6).join('\n'));
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (
      line.length > 12 &&
      /FAILED|UNREACHABLE|Exception|Permission denied|No such file|Connection timed out|INSTALLATION FAILED/i.test(
        line
      )
    ) {
      return sanitizeAtlasErrorDetail(line.slice(0, 600));
    }
  }
  return null;
}

function sanitizeAtlasErrorDetail(text) {
  if (!text) return text;
  let s = String(text).replace(/\u001b\[[0-9;]*m/g, '');
  s = s.replace(/svc_password=[^,\s"'\\]+/gi, 'svc_password=***');
  s = s.replace(/atlas_token=[^,\s"'\\]+/gi, 'atlas_token=***');
  s = s.replace(/atlas_automation_token=[^,\s"'\\]+/gi, 'atlas_automation_token=***');
  s = s.replace(/"svc_password"\s*:\s*"[^"]+"/gi, '"svc_password":"***"');

  const helm =
    s.match(/helm install failed with error -\s*Error: INSTALLATION FAILED:[^\n"\\]{0,240}/i) ||
    s.match(/Error: INSTALLATION FAILED:[^\n"\\]{0,240}/i);
  if (helm) {
    return helm[0]
      .trim()
      .replace(/\\+"?\s*\}?\s*$/g, '')
      .replace(/"+$/g, '')
      .trim()
      .slice(0, 800);
  }

  const perm = s.match(/PermissionError:\s*\[[^\]]+\]\s*[^\n\\"]+/i);
  if (perm) {
    const parts = [perm[0].trim()];
    if (/Validation Failure/i.test(s)) parts.push('Validation Failure');
    return parts.join('\n');
  }

  if (s.length > 500) {
    const fatalMsg = s.match(
      /fatal: \[[^\]]+\]: (?:FAILED|UNREACHABLE)! => \{"msg": "([^"]{0,200})"/
    );
    if (fatalMsg && fatalMsg[1] && fatalMsg[1].trim()) return fatalMsg[0];
  }
  return s.slice(0, 800);
}

function extractNestedJobIdsFromStdout(stdout) {
  let content = stdout?.content ?? stdout?.result?.content ?? '';
  if (typeof content !== 'string' || !content.trim()) return [];
  content = content.replace(/\\"/g, '"');
  const ids = [];
  for (const match of content.matchAll(/"jobId"\s*:\s*(\d+)/g)) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * DAY0 / wrapper playbooks often spawn a nested Atlas job (e.g. DirectDeploy)
 * that holds the real Helm failure. Drill into those when the monitor job's
 * own explanation is still a generic wrapper fatal.
 */
async function resolveNestedRootCauseJob(monitorJobSummary, { clusterId, launchedAfter } = {}) {
  if (!monitorJobSummary?.job_id || monitorJobSummary.status !== 'failed') {
    return monitorJobSummary;
  }

  let best = monitorJobSummary;
  let stdout = null;
  try {
    stdout = await atlasFetch(`/api/v2/jobs/${monitorJobSummary.job_id}/stdout/?format=json`);
  } catch {
    stdout = null;
  }

  const nestedIds = extractNestedJobIdsFromStdout(stdout)
    .filter((id) => id !== Number(monitorJobSummary.job_id))
    .sort((a, b) => b - a)
    .slice(0, 8);

  for (const id of nestedIds) {
    try {
      const fetched = await fetchAtlasJobRef({ id, kind: 'job' });
      const raw = String(fetched.job?.status || '').toLowerCase();
      if (!['failed', 'error'].includes(raw) && !fetched.job?.failed) continue;
      const enriched = await enrichJobFailureDetail(summarizeJob(fetched.job, fetched.kind));
      if (
        isMoreSpecificFailure(enriched.job_explanation, best.job_explanation) ||
        shouldPreferNestedJob(enriched, best)
      ) {
        best = enriched;
      }
    } catch {
      /* try next nested id */
    }
  }

  // Also check recent failed activity for this gNB after launch — catches
  // nested jobs that stdout referenced only indirectly.
  if (clusterId) {
    try {
      const activity = await fetchActivityStream(clusterId);
      const afterMs = launchedAfter ? new Date(launchedAfter).getTime() - 15_000 : 0;
      const failedRows = (activity?.results || [])
        .map((row) => {
          const ref = extractActivityJobRef(row);
          const status = String(row?.summary_fields?.job?.[0]?.status || '').toLowerCase();
          const ts = activityRowTimestamp(row);
          return {
            id: ref?.id,
            kind: ref?.kind || 'job',
            status,
            ts,
          };
        })
        .filter(
          (row) =>
            row.id &&
            ['failed', 'error'].includes(row.status) &&
            Number(row.id) !== Number(best.job_id) &&
            (!afterMs || !row.ts || new Date(row.ts).getTime() >= afterMs)
        )
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 5);

      for (const row of failedRows) {
        try {
          const fetched = await fetchAtlasJobRef({ id: row.id, kind: row.kind });
          const enriched = await enrichJobFailureDetail(
            summarizeJob(fetched.job, fetched.kind)
          );
          if (
            isMoreSpecificFailure(enriched.job_explanation, best.job_explanation) ||
            shouldPreferNestedJob(enriched, best)
          ) {
            best = enriched;
          }
        } catch {
          /* continue */
        }
      }
    } catch {
      /* activity optional */
    }
  }

  return best;
}

/**
 * A failed Atlas workflow only reports a generic explanation ("No error
 * handling paths found..."), and workflow jobs have no stdout of their own.
 * The usable cause lives in whichever child node failed, so fetch that job.
 */
async function findFailedWorkflowChildJob(workflowJobId) {
  if (!workflowJobId) return null;
  let nodes;
  try {
    nodes = await atlasFetch(
      `/api/v2/workflow_jobs/${workflowJobId}/workflow_nodes/?page_size=100`
    );
  } catch {
    return null;
  }

  const failed = (nodes?.results || [])
    .map((node) => node?.summary_fields?.job)
    .filter((job) => job?.id && ['failed', 'error'].includes(String(job.status).toLowerCase()));
  if (!failed.length) return null;

  // Atlas creates child jobs in order, so the highest id is the node the
  // workflow stopped on.
  const last = failed.reduce((latest, job) => (Number(job.id) > Number(latest.id) ? job : latest));
  try {
    const fetched = await fetchAtlasJobRef({ id: Number(last.id), kind: 'job' });
    return { job: fetched.job, kind: fetched.kind };
  } catch {
    return { job: last, kind: 'job' };
  }
}

async function enrichJobFailureDetail(summary) {
  if (summary?.status !== 'failed' || !summary?.job_id) return summary;

  let detail = null;
  try {
    const stdout = await atlasFetch(`/api/v2/jobs/${summary.job_id}/stdout/?format=json`);
    detail = extractFailureDetailFromStdout(stdout);
  } catch {
    /* stdout optional */
  }

  if (!detail && summary.job_explanation) {
    detail = sanitizeAtlasErrorDetail(summary.job_explanation);
  }

  if (detail) {
    return { ...summary, job_explanation: detail, terminal: true };
  }
  return { ...summary, terminal: summary.terminal ?? true };
}

function atlasSessionLookbackMs(operation) {
  const op = normalizeAtlasOperation(operation);
  return isAtlasMultiStepOperation(op) ? 45 * 60 * 1000 : 15_000;
}

function filterActivityAfterLaunch(
  activity,
  launchedAfter,
  operation = 'precheck',
  sessionLauncherJobId = null
) {
  if (!launchedAfter && !sessionLauncherJobId) return activity;
  const entries = activity?.results || activity?.items || [];
  if (!Array.isArray(entries)) return activity;
  const afterMs = launchedAfter
    ? new Date(launchedAfter).getTime() - atlasSessionLookbackMs(operation)
    : 0;
  const launchMs = launchedAfter ? new Date(launchedAfter).getTime() : 0;
  const sessionId = Number(sessionLauncherJobId);
  const hasSession = Number.isFinite(sessionId) && sessionId > 0;

  const filtered = entries.filter((row) => {
    const ts = activityRowTimestamp(row);
    const tsMs = ts ? new Date(ts).getTime() : null;
    if (afterMs && tsMs != null && tsMs < afterMs) return false;

    const ref = extractActivityJobRef(row);
    const jobId = ref?.id != null ? Number(ref.id) : null;

    // Atlas job ids increase. Drop anything from an earlier launch when we
    // know this session's workflow/launcher id — otherwise a prior deploy on
    // the same gNB DUID bleeds into the activity stream (45m lookback).
    if (hasSession && Number.isFinite(jobId) && jobId > 0 && jobId < sessionId) {
      return false;
    }

    // Unscoped rows (no job id) that predate this launch belong to prior runs.
    if (hasSession && (!Number.isFinite(jobId) || jobId <= 0) && launchMs && tsMs != null) {
      if (tsMs < launchMs - 5_000) return false;
    }

    return true;
  });
  return { ...activity, results: filtered };
}

function activityEntryStatus(row) {
  const jobStatus = String(row?.summary_fields?.job?.[0]?.status || '').toLowerCase();
  if (jobStatus === 'successful') return 'success';
  if (['failed', 'error'].includes(jobStatus)) return 'failed';
  if (jobStatus === 'running') return 'running';
  if (['pending', 'waiting', 'new'].includes(jobStatus)) return 'pending';

  const state = String(row.status || row.state || '').toLowerCase();
  if (state === 'successful') return 'success';
  if (['failed', 'error'].includes(state)) return 'failed';
  if (state === 'running') return 'running';
  if (['pending', 'waiting', 'new'].includes(state)) return 'pending';

  const summary = String(
    row.summary || row.description || row.job_template_name || row.name || ''
  ).toLowerCase();
  if (/\bsuccessful\b/.test(summary)) return 'success';
  if (/\bfailed\b/.test(summary) || /\berror\b/.test(summary)) return 'failed';
  if (/\brunning\b/.test(summary)) return 'running';
  if (/\b(pending|waiting|queued)\b/.test(summary)) return 'pending';
  if (/\blaunch(ed)?\b/.test(summary)) return 'running';
  return 'unknown';
}

function summarizeActivity(
  activity,
  clusterId,
  { launchedAfter, operation = 'precheck', sessionLauncherJobId = null } = {}
) {
  const scoped = filterActivityAfterLaunch(
    activity,
    launchedAfter,
    operation,
    sessionLauncherJobId
  );
  const results = scoped?.results || scoped?.items || [];
  const entries = Array.isArray(results) ? results : [];
  const sorted = [...entries].sort(
    (a, b) => new Date(activityRowTimestamp(b) || 0).getTime() - new Date(activityRowTimestamp(a) || 0).getTime()
  );
  const mapped = sorted.map((row) => {
    const summary = activityJobName(row) || row.summary || row.description || null;
    const jobRef = extractActivityJobRef(row);
    return {
      id: row.id,
      timestamp: activityRowTimestamp(row),
      summary,
      status: activityEntryStatus(row),
      operation: row.operation || row.type || null,
      job_id: jobRef?.id ?? null,
      job_kind: jobRef?.kind ?? null,
    };
  });

  // Prefer rows that carry a job id over duplicate template announcements
  // (same name, status "unknown", job_id null) that Atlas emits on launch.
  const namesWithJobId = new Set(
    mapped
      .filter((r) => r.job_id && r.summary)
      .map((r) => String(r.summary).trim().toLowerCase())
  );
  const recent = mapped
    .filter((r) => {
      const nameKey = r.summary ? String(r.summary).trim().toLowerCase() : '';
      if (!r.job_id && nameKey && namesWithJobId.has(nameKey)) return false;
      return true;
    })
    .slice(0, ACTIVITY_RECENT_LIMIT);

  let status = 'unknown';
  if (recent.some((r) => r.status === 'running')) status = 'running';
  else if (recent.some((r) => r.status === 'pending')) status = 'pending';
  else if (recent.some((r) => r.status === 'failed')) status = 'failed';
  else if (recent.some((r) => r.status === 'success')) status = 'success';
  else if (recent.length) status = 'pending';

  return {
    cluster_id: clusterId,
    status,
    count: entries.length,
    recent,
  };
}

function mergePrecheckStatus({
  monitorJobSummary,
  launcherJobSummary,
  activitySummary,
  waitingForWrapper,
  operation = 'precheck',
  workload = null,
}) {
  const opLabel = atlasOperationLabel(operation);
  const op = normalizeAtlasOperation(operation);
  let phase = 'unknown';
  let status = 'unknown';
  let message = 'Waiting for Atlas response';

  const activeJob = monitorJobSummary?.job_id ? monitorJobSummary : null;
  const effectiveWorkload =
    normalizeWorkload(workload) || inferWorkloadFromJobName(activeJob?.name || '');

  // The designated terminal playbook is not always the last node to run, so a
  // step can succeed and the workflow still fail afterwards. When the parent
  // workflow is finished and failed, its verdict wins over any child success.
  // The inverse also happens: an intermediate node (e.g. VDU Grow) can fail while
  // AWX continues on another path and the parent Zero Touch workflow ends successful.
  const parentWorkflowFailed = Boolean(
    launcherJobSummary?.terminal && launcherJobSummary?.status === 'failed'
  );
  const parentWorkflowSucceeded = Boolean(
    launcherJobSummary?.terminal && launcherJobSummary?.status === 'success'
  );

  if (activeJob) {
    const js = activeJob.status;
    if (js === 'success') {
      if (parentWorkflowFailed) {
        phase = 'complete';
        status = 'failed';
        message = activeJob.name
          ? `${activeJob.name} succeeded, but the Atlas ${opLabel} workflow failed at a later step`
          : `Atlas ${opLabel} workflow failed`;
      } else if (
        isAtlasMultiStepOperation(op) &&
        isIntermediateUpgradeSuccess(activeJob.name, effectiveWorkload, op)
      ) {
        phase = 'running';
        status = 'running';
        message = `${activeJob.name} — step complete, awaiting final ${opLabel} postcheck`;
      } else {
        phase = 'complete';
        status = 'success';
        message = activeJob.name
          ? `${activeJob.name} — successful`
          : `Atlas ${opLabel} successful`;
      }
    } else if (js === 'failed') {
      // If the parent workflow job has already finished (terminal) and failed,
      // the whole run is done — a "step failed, still in progress" message
      // would be wrong even if this particular step isn't the workflow's
      // designated terminal node (e.g. no failure-handling path was defined,
      // so AWX stopped the workflow right here).
      //
      // Same when the parent finished successful: AWX continued past this
      // intermediate failure (seen on 29991512805 Grow → Verification → success).
      const intermediateFailed =
        isAtlasWorkflowOperation(op) &&
        isAtlasUpgradeWorkflowJobName(activeJob.name, effectiveWorkload, op) &&
        !isAtlasUpgradeTerminalJobName(activeJob.name, effectiveWorkload, op);

      if (parentWorkflowSucceeded && intermediateFailed) {
        phase = 'complete';
        status = 'success';
        message = launcherJobSummary.name
          ? `${launcherJobSummary.name} — successful`
          : `Atlas ${opLabel} successful`;
      } else if (intermediateFailed && !parentWorkflowFailed) {
        phase = 'running';
        status = 'running';
        message = `${activeJob.name} — step failed, ${opLabel} still in progress`;
      } else {
        phase = 'complete';
        status = 'failed';
        const downstreamBlocked =
          activeJob.name && isWorkflowIntermediateJobName(activeJob.name, null, operation);
        // Name the failing job here and leave the raw cause to error_report, so
        // the UI does not print the same long Atlas text twice.
        message = activeJob.name
          ? downstreamBlocked
            ? `${activeJob.name} — failed (downstream playbooks will not run)`
            : `${activeJob.name} — failed`
          : sanitizeAtlasErrorDetail(activeJob.job_explanation) || `Atlas ${opLabel} failed`;
      }
    } else if (js === 'running') {
      phase = 'running';
      status = 'running';
      message = activeJob.name ? `${activeJob.name} — running` : `Atlas ${opLabel} running`;
    } else {
      phase = 'queued';
      status = 'pending';
      message = activeJob.name
        ? `${activeJob.name} — ${activeJob.raw_status || 'queued'}`
        : `Atlas ${opLabel} queued (${activeJob.raw_status || 'pending'})`;
    }
  } else if (
    waitingForWrapper &&
    isAtlasWorkflowOperation(op) &&
    launcherJobSummary?.status === 'failed' &&
    launcherJobSummary?.terminal
  ) {
    // The workflow job itself already finished (failed) and no recognizable
    // child/step job was found in Atlas activity — trust the workflow job's
    // own terminal result instead of waiting indefinitely.
    phase = 'complete';
    status = 'failed';
    message =
      sanitizeAtlasErrorDetail(launcherJobSummary.job_explanation) ||
      (launcherJobSummary.name ? `${launcherJobSummary.name} — failed` : `Atlas ${opLabel} failed`);
  } else if (
    waitingForWrapper &&
    isAtlasWorkflowOperation(op) &&
    launcherJobSummary?.terminal &&
    launcherJobSummary?.status === 'success'
  ) {
    // Same for success: Zero Touch deploy/undeploy is done when the parent
    // workflow is terminal successful, even if we never pinned a child
    // Verification/postcheck monitor (seen on 29991573163 Waiting).
    phase = 'complete';
    status = 'success';
    message = launcherJobSummary.name
      ? `${launcherJobSummary.name} — successful`
      : `Atlas ${opLabel} successful`;
  } else if (waitingForWrapper) {
    phase = 'monitoring';
    status = 'pending';
    const recent = activitySummary?.recent?.[0];
    if (isAtlasMultiStepOperation(operation) && recent?.summary) {
      message = `${opLabel} in progress — latest: ${recent.summary}${recent.status ? ` (${recent.status})` : ''}`;
    } else {
      message = `Launcher finished — waiting for ${opLabel} wrapper job in Atlas (usually 1–2 minutes)`;
    }
  } else if (launcherJobSummary?.job_id) {
    const js = launcherJobSummary.status;
    if (js === 'running' || js === 'pending') {
      phase = js === 'running' ? 'running' : 'queued';
      status = js;
      message = launcherJobSummary.name
        ? `${launcherJobSummary.name} — ${launcherJobSummary.raw_status || js}`
        : `Atlas launcher ${launcherJobSummary.raw_status || js}`;
    } else if (js === 'success') {
      if (
        isAtlasWorkflowOperation(op) &&
        launcherJobSummary.terminal &&
        isAtlasWorkflowLauncherName(launcherJobSummary.name, effectiveWorkload, op)
      ) {
        phase = 'complete';
        status = 'success';
        message = launcherJobSummary.name
          ? `${launcherJobSummary.name} — successful`
          : `Atlas ${opLabel} successful`;
      } else {
        phase = 'monitoring';
        status = 'pending';
        message = `Launcher finished — waiting for ${opLabel} wrapper job in Atlas`;
      }
    } else if (js === 'failed') {
      if (
        isAtlasWorkflowOperation(op) &&
        isAtlasWorkflowLauncherName(launcherJobSummary.name, effectiveWorkload, op)
      ) {
        phase = 'monitoring';
        status = 'running';
        message = `${opLabel[0].toUpperCase()}${opLabel.slice(1)} workflow finished — monitoring child playbooks in Atlas`;
      } else {
        phase = 'complete';
        status = 'failed';
        message =
          launcherJobSummary.job_explanation ||
          (launcherJobSummary.name ? `${launcherJobSummary.name} — failed` : 'Atlas launcher failed');
      }
    } else {
      phase = 'monitoring';
      status = 'pending';
      message = `Waiting for Atlas ${opLabel} wrapper job`;
    }
  } else if (activitySummary?.count) {
    phase = 'monitoring';
    status = 'pending';
    message =
      activitySummary.recent[0]?.summary ||
      `Activity stream: ${activitySummary.count} entr${activitySummary.count === 1 ? 'y' : 'ies'} since launch`;
  }

  return { phase, status, message };
}

async function applyActivityMonitorRef(
  wrapper,
  { launchedAfter, launcherJobId, operation, workload, clusterId }
) {
  if (!wrapper?.ref?.id) return null;
  try {
    const fetched = await fetchAtlasJobRef(wrapper.ref);
    if (
      jobBelongsToAtlasRun(fetched.job, {
        launchedAfter,
        launcherJobId,
        operation,
        workload,
        clusterId,
      })
    ) {
      return {
        monitorJobSummary: summarizeJob(fetched.job, fetched.kind),
        resolvedMonitorJobId: wrapper.ref.id,
        resolvedMonitorJobKind: wrapper.ref.kind,
      };
    }
  } catch (err) {
    const failed = wrapper.entryStatus === 'failed' || wrapper.raw_status === 'failed';
    return {
      monitorJobSummary: {
        job_id: wrapper.ref.id,
        job_kind: wrapper.ref.kind,
        name: wrapper.name,
        status: failed ? 'failed' : wrapper.raw_status === 'successful' ? 'success' : 'unknown',
        raw_status: wrapper.raw_status,
        error: err.message,
      },
      resolvedMonitorJobId: wrapper.ref.id,
      resolvedMonitorJobKind: wrapper.ref.kind,
    };
  }
  return null;
}

async function resolveMonitorFromJobsApi({
  clusterId,
  effectiveLauncherId,
  launcherJobSummary,
  effectiveWorkload,
  atlasOp,
  launchedAfter,
}) {
  if (!clusterId || !effectiveLauncherId) return null;
  const viaApi = await findMonitorJobViaJobsApi({
    clusterId,
    launcherJobId: effectiveLauncherId,
    launcherFinishedAt: launcherJobSummary?.finished || null,
    launchedAfter,
    workload: effectiveWorkload,
    operation: atlasOp,
  });
  if (!viaApi) return null;
  const applied = await applyActivityMonitorRef(viaApi, {
    launchedAfter,
    launcherJobId: effectiveLauncherId,
    operation: atlasOp,
    workload: effectiveWorkload,
    clusterId,
  });
  if (applied) return applied;
  try {
    const fetched = await fetchAtlasJobRef(viaApi.ref);
    if (jobExtraVarsContainsCluster(fetched.job, clusterId)) {
      return {
        monitorJobSummary: summarizeJob(fetched.job, fetched.kind),
        resolvedMonitorJobId: viaApi.ref.id,
        resolvedMonitorJobKind: viaApi.ref.kind,
      };
    }
  } catch {
    /* jobs API candidate could not be fetched */
  }
  return null;
}

async function promoteTerminalUpgradeMonitorFromActivity(
  activity,
  {
    monitorJobSummary,
    effectiveWorkload,
    atlasOp,
    launchedAfter,
    effectiveLauncherId,
    clusterId,
  }
) {
  if (
    !monitorJobSummary ||
    monitorJobSummary.status !== 'success' ||
    (atlasOp !== 'upgrade' && atlasOp !== 'rollback' && !isAtlasWorkflowOperation(atlasOp)) ||
    !isIntermediateUpgradeSuccess(monitorJobSummary.name, effectiveWorkload, atlasOp)
  ) {
    return null;
  }

  const terminal = findWrapperJobInActivity(activity, {
    launchedAfter,
    launcherJobId: null,
    launcherFinishedAt: monitorJobSummary?.finished || null,
    operation: atlasOp,
    workload: effectiveWorkload,
  });
  if (terminal && isAtlasUpgradeTerminalJobName(terminal.name, effectiveWorkload, atlasOp)) {
    return applyActivityMonitorRef(terminal, {
      launchedAfter,
      launcherJobId: effectiveLauncherId,
      operation: atlasOp,
      workload: effectiveWorkload,
      clusterId,
    });
  }

  return resolveMonitorFromJobsApi({
    clusterId,
    effectiveLauncherId,
    launcherJobSummary: monitorJobSummary,
    effectiveWorkload,
    atlasOp,
    launchedAfter,
  });
}

async function getSamsungPrecheckStatus({
  clusterId,
  jobId,
  jobKind,
  launchedAfter,
  launcherJobId,
  sessionLauncherJobId,
  monitorJobId,
  monitorJobKind,
  operation = 'precheck',
  workload,
} = {}) {
  const atlasOp = normalizeAtlasOperation(operation);
  if (!clusterId && !jobId && !launcherJobId && !monitorJobId) {
    const err = new Error('cluster_id or job_id is required');
    err.status = 400;
    throw err;
  }

  let monitorJobSummary = null;
  let launcherJobSummary = null;
  let resolvedMonitorJobId = monitorJobId || null;
  let resolvedMonitorJobKind = monitorJobKind || null;
  let activitySummary = {
    cluster_id: clusterId || '',
    status: 'unknown',
    count: 0,
    recent: [],
  };
  let waitingForWrapper = false;

  let effectiveLauncherId = launcherJobId || jobId || null;
  const sessionLaunchedAfter = launchedAfter || null;
  const sessionLauncherId =
    Number(sessionLauncherJobId) || Number(launcherJobId) || Number(jobId) || null;
  let effectiveWorkload = normalizeWorkload(workload);

  if (
    clusterId &&
    effectiveLauncherId &&
    (atlasOp === 'upgrade' || atlasOp === 'rollback')
  ) {
    const newerLauncher = await findLatestLauncherJobForCluster({
      clusterId,
      workload: effectiveWorkload,
      minLauncherJobId: effectiveLauncherId,
    });
    if (newerLauncher?.id > Number(effectiveLauncherId)) {
      effectiveLauncherId = newerLauncher.id;
      resolvedMonitorJobId = null;
      resolvedMonitorJobKind = null;
      launcherJobSummary = null;
    }
  }

  if (resolvedMonitorJobId) {
    const kind = resolvedMonitorJobKind === 'workflow_job' ? 'workflow_job' : 'job';
    try {
      const fetched = await fetchAtlasJobRef({ id: resolvedMonitorJobId, kind });
      if (
        jobBelongsToAtlasRun(fetched.job, {
          launchedAfter: sessionLaunchedAfter,
          launcherJobId: effectiveLauncherId,
          operation: atlasOp,
          workload: effectiveWorkload,
          clusterId,
        })
      ) {
        monitorJobSummary = summarizeJob(fetched.job, fetched.kind);
        resolvedMonitorJobKind = fetched.kind;
        effectiveWorkload = effectiveWorkload || inferWorkloadFromJobName(fetched.job?.name);
      } else {
        resolvedMonitorJobId = null;
        resolvedMonitorJobKind = null;
      }
    } catch (err) {
      resolvedMonitorJobId = null;
      resolvedMonitorJobKind = null;
    }
  }

  if (
    effectiveLauncherId &&
    (!launcherJobSummary || launcherJobSummary.job_id !== effectiveLauncherId)
  ) {
    const kind = jobKind === 'workflow_job' ? 'workflow_job' : 'job';
    try {
      const fetched = await fetchAtlasJobRef({ id: effectiveLauncherId, kind });
      if (jobPredatesRun(fetched.job, sessionLaunchedAfter)) {
        // Left over from an earlier run of this operation. Trusting it would
        // report the previous run's outcome against the current launch, so drop
        // the pin and fall through to discovery for this session.
        effectiveLauncherId = null;
        launcherJobSummary = null;
        resolvedMonitorJobId = null;
        resolvedMonitorJobKind = null;
      } else {
        launcherJobSummary = summarizeJob(fetched.job, fetched.kind);
        effectiveWorkload = effectiveWorkload || inferWorkloadFromJobName(fetched.job?.name);
      }
    } catch (err) {
      launcherJobSummary = {
        job_id: effectiveLauncherId,
        job_kind: kind,
        status: 'unknown',
        raw_status: null,
        error: err.message,
      };
    }
  }

  if (clusterId) {
    try {
      const activity = await fetchActivityStream(clusterId);
      activitySummary = summarizeActivity(activity, clusterId, {
        launchedAfter: sessionLaunchedAfter,
        operation: atlasOp,
        sessionLauncherJobId: sessionLauncherId || effectiveLauncherId,
      });

      if (!monitorJobSummary) {
        const wrapper = findWrapperJobInActivity(activity, {
          launchedAfter: sessionLaunchedAfter,
          launcherJobId: effectiveLauncherId,
          launcherFinishedAt: launcherJobSummary?.finished || null,
          operation: atlasOp,
          workload: effectiveWorkload,
        });
        if (wrapper) {
          resolvedMonitorJobId = wrapper.ref.id;
          resolvedMonitorJobKind = wrapper.ref.kind;
          try {
            const fetched = await fetchAtlasJobRef(wrapper.ref);
            if (
              jobBelongsToAtlasRun(fetched.job, {
                launchedAfter: sessionLaunchedAfter,
                launcherJobId: effectiveLauncherId,
                operation: atlasOp,
                workload: effectiveWorkload,
                clusterId,
              })
            ) {
              monitorJobSummary = summarizeJob(fetched.job, fetched.kind);
            } else {
              resolvedMonitorJobId = null;
              resolvedMonitorJobKind = null;
            }
          } catch (err) {
            monitorJobSummary = {
              job_id: wrapper.ref.id,
              job_kind: wrapper.ref.kind,
              name: wrapper.name,
              status: 'unknown',
              raw_status: wrapper.raw_status,
              error: err.message,
            };
          }
        } else if (
          launcherJobSummary?.status === 'success' ||
          (launcherJobSummary?.terminal && launcherJobSummary?.status !== 'failed') ||
          (isAtlasWorkflowOperation(atlasOp) &&
            launcherJobSummary?.terminal &&
            isAtlasWorkflowLauncherName(launcherJobSummary?.name, effectiveWorkload, atlasOp))
        ) {
          const launcherFinishedAt = launcherJobSummary?.finished || null;
          // When the parent workflow already succeeded, prefer the terminal
          // success playbook over an earlier intermediate failure (e.g. Grow).
          const preferSuccessFirst =
            launcherJobSummary?.terminal && launcherJobSummary?.status === 'success';

          const successChild = preferSuccessFirst
            ? findWrapperJobInActivity(activity, {
                launchedAfter: sessionLaunchedAfter,
                launcherFinishedAt: null,
                launcherJobId: effectiveLauncherId,
                workload: effectiveWorkload,
                operation: atlasOp,
              })
            : null;

          if (successChild) {
            resolvedMonitorJobId = successChild.ref.id;
            resolvedMonitorJobKind = successChild.ref.kind;
            try {
              const fetched = await fetchAtlasJobRef(successChild.ref);
              if (
                jobBelongsToAtlasRun(fetched.job, {
                  launchedAfter: sessionLaunchedAfter,
                  launcherJobId: effectiveLauncherId,
                  operation: atlasOp,
                  workload: effectiveWorkload,
                  clusterId,
                })
              ) {
                monitorJobSummary = summarizeJob(fetched.job, fetched.kind);
              } else {
                waitingForWrapper = true;
              }
            } catch (err) {
              monitorJobSummary = {
                job_id: successChild.ref.id,
                job_kind: successChild.ref.kind,
                name: successChild.name,
                status: 'success',
                raw_status: successChild.raw_status || 'successful',
                terminal: true,
              };
            }
          } else {
          const failedChild = findWorkflowJobInActivity(activity, {
            launchedAfter: sessionLaunchedAfter,
            launcherFinishedAt,
            launcherJobId: effectiveLauncherId,
            statuses: ['failed'],
            workload: effectiveWorkload,
            operation: atlasOp,
          });

          if (failedChild) {
            resolvedMonitorJobId = failedChild.ref.id;
            resolvedMonitorJobKind = failedChild.ref.kind;
            try {
              const fetched = await fetchAtlasJobRef(failedChild.ref);
              monitorJobSummary = await enrichJobFailureDetail(
                summarizeJob(fetched.job, fetched.kind)
              );
            } catch (err) {
              monitorJobSummary = {
                job_id: failedChild.ref.id,
                job_kind: failedChild.ref.kind,
                name: failedChild.name,
                status: 'failed',
                raw_status: failedChild.raw_status || 'failed',
                terminal: true,
                job_explanation: `Failed playbook — could not fetch job details (${err.message})`,
              };
            }
          } else {
            const runningChild = findWorkflowJobInActivity(activity, {
              launchedAfter: sessionLaunchedAfter,
              launcherFinishedAt,
              launcherJobId: effectiveLauncherId,
              statuses: ['running', 'pending'],
              workload: effectiveWorkload,
              operation: atlasOp,
            });
            if (runningChild) {
              resolvedMonitorJobId = runningChild.ref.id;
              resolvedMonitorJobKind = runningChild.ref.kind;
              try {
                const fetched = await fetchAtlasJobRef(runningChild.ref);
                monitorJobSummary = summarizeJob(fetched.job, fetched.kind);
              } catch (err) {
                monitorJobSummary = {
                  job_id: runningChild.ref.id,
                  job_kind: runningChild.ref.kind,
                  name: runningChild.name,
                  status: runningChild.entryStatus === 'pending' ? 'pending' : 'running',
                  raw_status: runningChild.raw_status || runningChild.entryStatus,
                  terminal: false,
                };
              }
            } else if (isAtlasMultiStepOperation(atlasOp)) {
              const successChildLate = findWorkflowJobInActivity(activity, {
                launchedAfter: sessionLaunchedAfter,
                launcherFinishedAt,
                launcherJobId: effectiveLauncherId,
                statuses: ['success'],
                workload: effectiveWorkload,
                operation: atlasOp,
              });
              if (successChildLate) {
                resolvedMonitorJobId = successChildLate.ref.id;
                resolvedMonitorJobKind = successChildLate.ref.kind;
                try {
                  const fetched = await fetchAtlasJobRef(successChildLate.ref);
                  if (
                    jobBelongsToAtlasRun(fetched.job, {
                      launchedAfter: sessionLaunchedAfter,
                      launcherJobId: effectiveLauncherId,
                      operation: atlasOp,
                      workload: effectiveWorkload,
                      clusterId,
                    })
                  ) {
                    monitorJobSummary = summarizeJob(fetched.job, fetched.kind);
                  } else {
                    waitingForWrapper = true;
                  }
                } catch (err) {
                  monitorJobSummary = {
                    job_id: successChildLate.ref.id,
                    job_kind: successChildLate.ref.kind,
                    name: successChildLate.name,
                    status: 'success',
                    raw_status: successChildLate.raw_status || 'successful',
                    terminal: true,
                  };
                }
              } else {
                waitingForWrapper = true;
              }
            } else {
              waitingForWrapper = true;
            }
          }
          }
        }
      }

      const promoted = await promoteTerminalUpgradeMonitorFromActivity(activity, {
        monitorJobSummary,
        effectiveWorkload,
        atlasOp,
        launchedAfter: sessionLaunchedAfter,
        effectiveLauncherId,
        clusterId,
      });
      if (promoted) {
        monitorJobSummary = promoted.monitorJobSummary;
        resolvedMonitorJobId = promoted.resolvedMonitorJobId;
        resolvedMonitorJobKind = promoted.resolvedMonitorJobKind;
        waitingForWrapper = false;
      } else if (
        !monitorJobSummary &&
        effectiveLauncherId &&
        (launcherJobSummary?.status === 'success' || waitingForWrapper)
      ) {
        const viaApi = await resolveMonitorFromJobsApi({
          clusterId,
          effectiveLauncherId,
          launcherJobSummary,
          effectiveWorkload,
          atlasOp,
          launchedAfter: sessionLaunchedAfter,
        });
        if (viaApi) {
          monitorJobSummary = viaApi.monitorJobSummary;
          resolvedMonitorJobId = viaApi.resolvedMonitorJobId;
          resolvedMonitorJobKind = viaApi.resolvedMonitorJobKind;
          waitingForWrapper = false;
          if (monitorJobSummary?.status === 'failed') {
            monitorJobSummary = await enrichJobFailureDetail(monitorJobSummary);
          }
        }
      }

      // Intermediate child (e.g. Grow) failed earlier, but the parent Zero Touch
      // workflow later finished successful. Promote to Verification, or unpin to
      // the parent workflow so the UI does not stay "still in progress".
      if (
        monitorJobSummary?.status === 'failed' &&
        launcherJobSummary?.terminal &&
        launcherJobSummary?.status === 'success' &&
        isAtlasWorkflowOperation(atlasOp) &&
        !isAtlasUpgradeTerminalJobName(
          monitorJobSummary.name,
          effectiveWorkload,
          atlasOp
        )
      ) {
        const terminal = findWrapperJobInActivity(activity, {
          launchedAfter: sessionLaunchedAfter,
          launcherFinishedAt: null,
          launcherJobId: effectiveLauncherId,
          workload: effectiveWorkload,
          operation: atlasOp,
        });
        let promotedPastFailure = false;
        if (
          terminal?.ref?.id &&
          isAtlasUpgradeTerminalJobName(terminal.name, effectiveWorkload, atlasOp)
        ) {
          const applied = await applyActivityMonitorRef(terminal, {
            launchedAfter: sessionLaunchedAfter,
            launcherJobId: effectiveLauncherId,
            operation: atlasOp,
            workload: effectiveWorkload,
            clusterId,
          });
          if (applied?.monitorJobSummary?.status === 'success') {
            monitorJobSummary = applied.monitorJobSummary;
            resolvedMonitorJobId = applied.resolvedMonitorJobId;
            resolvedMonitorJobKind = applied.resolvedMonitorJobKind;
            waitingForWrapper = false;
            promotedPastFailure = true;
          }
        }
        if (!promotedPastFailure) {
          monitorJobSummary = { ...launcherJobSummary };
          resolvedMonitorJobId = launcherJobSummary.job_id;
          resolvedMonitorJobKind = launcherJobSummary.job_kind || 'workflow_job';
          waitingForWrapper = false;
        }
      }

      // No child monitor found, but the parent Zero Touch workflow already
      // finished successful — stop Waiting and trust the workflow job.
      if (
        waitingForWrapper &&
        !monitorJobSummary &&
        launcherJobSummary?.terminal &&
        launcherJobSummary?.status === 'success' &&
        isAtlasWorkflowOperation(atlasOp)
      ) {
        monitorJobSummary = { ...launcherJobSummary };
        resolvedMonitorJobId = launcherJobSummary.job_id;
        resolvedMonitorJobKind = launcherJobSummary.job_kind || 'workflow_job';
        waitingForWrapper = false;
      }
    } catch (err) {
      activitySummary.error = err.message;
    }
  }

  if (clusterId && effectiveLauncherId) {
    activitySummary = await enrichActivityFromJobsApi(activitySummary, {
      clusterId,
      launcherJobId: effectiveLauncherId,
      minJobId: sessionLauncherId,
      launcherJobSummary: launcherJobSummary,
      launchedAfter: sessionLaunchedAfter,
      workload: effectiveWorkload,
      operation: atlasOp,
    });
  }

  // The MOP's terminal playbook can pass before a later node fails, leaving the
  // monitor pointing at a success while the workflow failed. Report the node
  // that actually failed instead, so the UI shows a real cause.
  if (
    isAtlasWorkflowOperation(atlasOp) &&
    effectiveLauncherId &&
    launcherJobSummary?.terminal &&
    launcherJobSummary?.status === 'failed' &&
    monitorJobSummary?.status !== 'failed'
  ) {
    const failedChild = await findFailedWorkflowChildJob(effectiveLauncherId);
    if (failedChild?.job?.id) {
      monitorJobSummary = summarizeJob(failedChild.job, failedChild.kind);
      resolvedMonitorJobId = failedChild.job.id;
      resolvedMonitorJobKind = failedChild.kind;
      waitingForWrapper = false;
    }
  }

  if (monitorJobSummary?.status === 'failed') {
    monitorJobSummary = await enrichJobFailureDetail(monitorJobSummary);
    // Wrapper nodes (DAY0) often spawn nested DirectDeploy/Helm jobs that hold
    // the actionable root cause — promote those into the monitor/error report.
    const nested = await resolveNestedRootCauseJob(monitorJobSummary, {
      clusterId,
      launchedAfter: sessionLaunchedAfter,
    });
    if (nested?.job_id && Number(nested.job_id) !== Number(monitorJobSummary.job_id)) {
      monitorJobSummary = nested;
      resolvedMonitorJobId = nested.job_id;
      resolvedMonitorJobKind = nested.job_kind || 'job';
      waitingForWrapper = false;
    } else if (nested) {
      monitorJobSummary = nested;
    }
  }

  const merged = mergePrecheckStatus({
    monitorJobSummary,
    launcherJobSummary,
    activitySummary,
    waitingForWrapper,
    operation: atlasOp,
    workload: effectiveWorkload,
  });

  // Fall back to the workflow job when the monitored step passed but the
  // workflow itself failed later, so the UI still gets a failure to show.
  const failedJob =
    monitorJobSummary?.status === 'failed'
      ? monitorJobSummary
      : merged.status === 'failed' &&
          launcherJobSummary?.terminal &&
          launcherJobSummary?.status === 'failed'
        ? launcherJobSummary
        : null;

  let errorReport = null;
  if (failedJob && merged.status === 'failed') {
    const detail =
      sanitizeAtlasErrorDetail(failedJob.job_explanation) ||
      sanitizeAtlasErrorDetail(merged.message);
    let analysis = null;
    let stdoutExcerpt = '';
    try {
      const stdout = await atlasFetch(
        `/api/v2/jobs/${failedJob.job_id}/stdout/?format=json`
      );
      stdoutExcerpt = String(stdout?.content || '').slice(-4500);
    } catch {
      /* optional */
    }
    analysis = await analyzeAtlasFailureWithOllama({
      clusterId,
      operation: atlasOp,
      jobId: failedJob.job_id,
      jobName: failedJob.name,
      detail,
      stdoutExcerpt,
    });
    errorReport = {
      job_id: failedJob.job_id,
      name: failedJob.name,
      detail: analysis?.root_cause || detail,
      raw_detail: detail,
      analysis: analysis || null,
    };
  }

  return {
    cluster_id: clusterId || null,
    launcher_job_id: effectiveLauncherId,
    monitor_job_id: resolvedMonitorJobId,
    monitor_job_kind: resolvedMonitorJobKind,
    job: monitorJobSummary || launcherJobSummary,
    launcher_job: launcherJobSummary,
    activity: activitySummary,
    phase: merged.phase,
    status: merged.status,
    message: merged.message,
    error_report: errorReport,
    launched_at: sessionLaunchedAfter,
    checked_at: new Date().toISOString(),
  };
}

function atlasOperationLabel(operation) {
  const op = normalizeAtlasOperation(operation);
  if (op === 'upgrade') return 'upgrade';
  if (op === 'rollback') return 'rollback';
  if (op === 'undeployment') return 'undeployment';
  if (op === 'deployment') return 'deployment';
  return 'precheck';
}

async function resolveRollbackVersion(deviceId) {
  const tracker = await loadSamsungSoftwareTracker(deviceId);
  if (tracker?.rollback_release?.trim()) {
    return tracker.rollback_release.trim();
  }

  const upgrade = await loadSamsungAtlasSnapshot(deviceId, 'upgrade');
  if (upgrade?.previous_version?.trim()) {
    return upgrade.previous_version.trim();
  }

  try {
    const pods = await listDevicePods(deviceId);
    const current = pods?.software_version?.trim();
    const upgradeTarget = upgrade?.version?.trim();
    if (current && upgradeTarget && current !== upgradeTarget) {
      return current;
    }
  } catch {
    /* pods optional fallback */
  }

  return null;
}

async function clearSamsungAtlasLifecycleForUndeployment(deviceId) {
  await db.query(
    `DELETE FROM network_samsung_precheck_snapshots
     WHERE device_id = $1 AND operation IN ('precheck', 'upgrade', 'rollback')`,
    [deviceId]
  );
  await clearRollbackBaseline(deviceId);
  return {
    precheck: true,
    upgrade: true,
    rollback: true,
    rollback_baseline: true,
  };
}

async function runSamsungAtlasJob(
  deviceId,
  {
    operation = 'precheck',
    version,
    confirmClusterId,
    workloadOverride,
    upgradeTargetVersion,
    ciqSource,
    reportedBy = 'system',
  } = {}
) {
  const op = normalizeAtlasOperation(operation);
  const opLabel = atlasOperationLabel(op);
  const device = await loadDevice(deviceId);
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }
  if (confirmClusterId && confirmClusterId !== device.cluster_id) {
    const err = new Error('confirm_cluster_id does not match device cluster_id');
    err.status = 400;
    throw err;
  }
  if (!isSamsungApplication(device)) {
    const err = new Error(
      `Device application is "${device.application || '—'}" — Samsung ${opLabel} applies to Samsung vDUs only`
    );
    err.status = 400;
    throw err;
  }
  let podResult = null;
  try {
    podResult = await listDevicePods(deviceId);
  } catch {
    podResult = { pods: [] };
  }

  let resolvedVersion = version?.trim() || '';
  if (op === 'rollback' && !resolvedVersion) {
    resolvedVersion = (await resolveRollbackVersion(deviceId)) || '';
  }
  if (op === 'undeployment' && !resolvedVersion) {
    const tracker = await loadSamsungSoftwareTracker(deviceId);
    resolvedVersion =
      tracker?.current_release?.trim() || podResult?.software_version?.trim() || '';
  }
  if (!resolvedVersion) {
    const err = new Error(
      op === 'rollback'
        ? 'Rollback version is required — could not determine pre-upgrade software version. Launch an upgrade from the dashboard first (captures prior SW) or pass version explicitly.'
        : op === 'undeployment'
          ? 'Current running software version is required — refresh the Pods tab or pass version explicitly.'
          : 'Target software version is required (e.g. 23.B.0-0100)'
    );
    err.status = 400;
    throw err;
  }

  let clearedPriorAtlas = null;
  if (op === 'undeployment') {
    clearedPriorAtlas = await clearSamsungAtlasLifecycleForUndeployment(deviceId);
  }

  const previousVersion =
    op === 'upgrade' ? podResult?.software_version?.trim() || null : null;

  const override = normalizeWorkload(workloadOverride);
  const detected =
    override != null
      ? { workload: override, source: 'manual' }
      : detectSamsungWorkloadFromHints({
          pods: podResult?.pods,
          clusterId: device.cluster_id,
          softwareVersion: podResult?.software_version,
          buildInfo: podResult?.build_info,
          modelType: device.model_type,
          siteType: device.site_type,
        });

  if (!detected) {
    const podHint = podResult?.pods?.length
      ? ` Found ${podResult.pods.length} pod(s) but none matched uadpf/adpf naming.`
      : podResult?.error
        ? ` Pod fetch failed: ${podResult.error}`
        : ' No pods returned — refresh the Pods tab first.';
    const err = new Error(
      `Could not determine UDU vs VDU.${podHint} Software column shows ${
        podResult?.software_version || device.model_type || '—'
      }. Site type: ${device.site_type || '—'} (must contain UDU or VDU — set it in the vDU_List "Site type" column and Sync from Drive). You can pass workload=UDU or VDU if needed.`
    );
    err.status = 400;
    throw err;
  }

  const workload = detected.workload;
  const launchedAt = new Date().toISOString();
  let launch;
  let templateId;
  let resolvedCiqSource = null;
  if (op === 'undeployment' || op === 'deployment') {
    if (op === 'deployment' && workload === 'UDU' && !device.fuze_project_id) {
      const err = new Error(
        `UDU deployment requires a Fuze Project Id, but none is set for ${device.cluster_id}. ` +
          `Add it to the vDU_List "FUZE project ID" column and Sync from Drive.`
      );
      err.status = 400;
      throw err;
    }
    templateId =
      op === 'deployment'
        ? atlasDeployTemplateForWorkload(workload)
        : atlasUndeployTemplateForWorkload(workload);
    const payload =
      op === 'deployment'
        ? buildDeploymentPayload(
            device.cluster_id,
            resolvedVersion,
            device.fuze_project_id,
            ciqSource
          )
        : buildUndeploymentPayload(device.cluster_id, resolvedVersion, device.fuze_project_id);
    resolvedCiqSource = payload.extra_vars.ciqSource;
    launch = await launchAtlasWorkflowJob(templateId, payload);
  } else {
    templateId = atlasTemplateForWorkload(workload);
    const payload = buildAtlasBatchPayload(device.cluster_id, resolvedVersion, op);
    launch = await launchAtlasJob(workload, payload);
  }
  const jobRef = parseLaunchJobRef(launch);
  const launcherJobId = jobRef?.id ?? null;
  const launcherJobKind = jobRef?.kind ?? null;

  let progress = {
    phase: launcherJobId ? 'queued' : 'monitoring',
    status: 'pending',
    message: launcherJobId
      ? `Atlas launcher #${launcherJobId} submitted`
      : 'Batch submitted — polling activity stream',
    job: null,
    activity: { cluster_id: device.cluster_id, status: 'unknown', count: 0, recent: [] },
  };

  if (launcherJobId || device.cluster_id) {
    progress = await getSamsungPrecheckStatus({
      clusterId: device.cluster_id,
      jobId: launcherJobId,
      jobKind: launcherJobKind,
      launchedAfter: launchedAt,
      launcherJobId,
      sessionLauncherJobId: launcherJobId,
      operation: op,
      workload,
    });
  }

  const reporter =
    typeof reportedBy === 'string' && reportedBy.trim() ? reportedBy.trim() : 'system';

  const result = {
    device_id: device.id,
    cluster_id: device.cluster_id,
    operation: op,
    workload,
    workload_source: detected.source,
    template_id: templateId,
    version: resolvedVersion,
    ciq_source: resolvedCiqSource,
    previous_version: previousVersion,
    upgrade_target_version:
      op === 'rollback' ? upgradeTargetVersion?.trim() || null : op === 'upgrade' ? resolvedVersion : null,
    job_id: launcherJobId,
    job_kind: launcherJobKind,
    launcher_job_id: launcherJobId,
    launcher_job_kind: launcherJobKind,
    session_launcher_job_id: launcherJobId,
    monitor_job_id: progress.monitor_job_id ?? null,
    monitor_job_kind: progress.monitor_job_kind ?? null,
    launch,
    phase: progress.phase,
    status: progress.status,
    message: progress.message,
    job: progress.job,
    launcher_job: progress.launcher_job,
    activity: progress.activity,
    launched_at: launchedAt,
    updated_at: progress.checked_at || launchedAt,
    cleared_prior_atlas: clearedPriorAtlas,
    reported_by: reporter,
  };

  await saveSamsungAtlasSnapshot(device.id, result, op);

  if (progress.status === 'failed') {
    try {
      await recordSamsungIssueFailure({
        deviceId: device.id,
        clusterId: device.cluster_id,
        siteType: device.site_type,
        operation: op,
        issueDescription:
          progress.error_report?.detail || progress.message || 'Samsung action failed',
        launcherJobId,
        monitorJobId: progress.monitor_job_id ?? null,
        atlasJobName:
          progress.error_report?.name ||
          progress.job?.name ||
          progress.launcher_job?.name ||
          null,
        launchedAt,
        userReporter: reporter,
      });
    } catch (logErr) {
      console.warn('[samsung-issue-log] failed to record launch failure:', logErr.message);
    }
  }

  return result;
}

async function runSamsungPrecheck(deviceId, options = {}) {
  let podResult = null;
  try {
    podResult = await listDevicePods(deviceId);
  } catch {
    podResult = null;
  }
  await captureRollbackBaseline(deviceId, podResult);
  return runSamsungAtlasJob(deviceId, { ...options, operation: 'precheck' });
}

async function runSamsungUpgrade(deviceId, options = {}) {
  return runSamsungAtlasJob(deviceId, { ...options, operation: 'upgrade' });
}

async function runSamsungRollback(deviceId, options = {}) {
  const upgrade = await loadSamsungAtlasSnapshot(deviceId, 'upgrade');
  return runSamsungAtlasJob(deviceId, {
    ...options,
    operation: 'rollback',
    upgradeTargetVersion: upgrade?.version || null,
  });
}

async function runSamsungUndeployment(deviceId, options = {}) {
  return runSamsungAtlasJob(deviceId, { ...options, operation: 'undeployment' });
}

async function runSamsungDeployment(deviceId, options = {}) {
  return runSamsungAtlasJob(deviceId, { ...options, operation: 'deployment' });
}

function buildSnapshotResult(run) {
  return {
    operation: run.operation || 'precheck',
    cluster_id: run.cluster_id,
    workload: run.workload,
    workload_source: run.workload_source,
    version: run.version,
    ciq_source: run.ciq_source ?? null,
    previous_version: run.previous_version ?? null,
    upgrade_target_version: run.upgrade_target_version ?? null,
    template_id: run.template_id,
    job_id: run.job_id,
    job_kind: run.job_kind,
    launcher_job_id: run.launcher_job_id,
    session_launcher_job_id: run.session_launcher_job_id ?? run.launcher_job_id ?? null,
    monitor_job_id: run.monitor_job_id,
    monitor_job_kind: run.monitor_job_kind,
    job: run.job,
    launcher_job: run.launcher_job,
    activity: run.activity,
    cancelled_at: run.cancelled_at ?? null,
    cancelled_reason: run.cancelled_reason ?? null,
    reported_by: run.reported_by ?? null,
  };
}

async function saveSamsungAtlasSnapshot(deviceId, run, operation = 'precheck') {
  const op = normalizeAtlasOperation(operation);
  const launchedAt = run.launched_at || new Date().toISOString();
  const updatedAt = run.updated_at || run.checked_at || new Date().toISOString();
  await db.query(
    `INSERT INTO network_samsung_precheck_snapshots
       (device_id, operation, status, phase, message, result, error, launched_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (device_id, operation) DO UPDATE SET
       status = EXCLUDED.status,
       phase = EXCLUDED.phase,
       message = EXCLUDED.message,
       result = EXCLUDED.result,
       error = EXCLUDED.error,
       launched_at = EXCLUDED.launched_at,
       updated_at = EXCLUDED.updated_at`,
    [
      deviceId,
      op,
      run.status || 'unknown',
      run.phase || null,
      run.message || null,
      JSON.stringify(buildSnapshotResult({ ...run, operation: op })),
      run.error || null,
      launchedAt,
      updatedAt,
    ]
  );
}

async function saveSamsungPrecheckSnapshot(deviceId, run) {
  return saveSamsungAtlasSnapshot(deviceId, run, 'precheck');
}

async function loadSamsungAtlasSnapshot(deviceId, operation = 'precheck') {
  const op = normalizeAtlasOperation(operation);
  const { rows } = await db.query(
    `SELECT * FROM network_samsung_precheck_snapshots WHERE device_id = $1 AND operation = $2`,
    [deviceId, op]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const result = r.result || {};
  return {
    device_id: r.device_id,
    operation: r.operation || op,
    cluster_id: result.cluster_id || null,
    workload: result.workload || 'VDU',
    workload_source: result.workload_source,
    version: result.version || '',
    previous_version: result.previous_version ?? null,
    upgrade_target_version: result.upgrade_target_version ?? null,
    template_id: result.template_id || 0,
    job_id: result.job_id ?? result.launcher_job_id ?? null,
    job_kind: result.job_kind ?? null,
    launcher_job_id: result.launcher_job_id ?? null,
    session_launcher_job_id: result.session_launcher_job_id ?? result.launcher_job_id ?? null,
    monitor_job_id: result.monitor_job_id ?? null,
    monitor_job_kind: result.monitor_job_kind ?? null,
    status: r.status,
    phase: r.phase,
    message: r.message,
    error: r.error,
    launched_at: r.launched_at,
    updated_at: r.updated_at,
    job: result.job ?? null,
    launcher_job: result.launcher_job ?? null,
    activity: result.activity ?? {
      cluster_id: result.cluster_id || '',
      status: 'unknown',
      count: 0,
      recent: [],
    },
    cancelled_at: result.cancelled_at ?? null,
    cancelled_reason: result.cancelled_reason ?? null,
    reported_by: result.reported_by ?? null,
  };
}

async function loadSamsungPrecheckSnapshot(deviceId) {
  return loadSamsungAtlasSnapshot(deviceId, 'precheck');
}

function mapSamsungAtlasSnapshotRow(row, prefix) {
  const launchedAt = row?.[`${prefix}_launched_at`];
  if (!launchedAt) return null;
  const result = row[`${prefix}_result`] || {};
  return {
    status: row[`${prefix}_status`],
    phase: row[`${prefix}_phase`],
    message: row[`${prefix}_message`],
    error: row[`${prefix}_error`],
    launched_at: launchedAt,
    updated_at: row[`${prefix}_updated_at`],
    cluster_id: result.cluster_id || null,
    workload: result.workload || 'VDU',
    version: result.version || '',
    previous_version: result.previous_version ?? null,
    upgrade_target_version: result.upgrade_target_version ?? null,
    template_id: result.template_id || 0,
    job_kind: result.job_kind ?? null,
    launcher_job_id: result.launcher_job_id ?? null,
    monitor_job_id: result.monitor_job_id ?? null,
    monitor_job_kind: result.monitor_job_kind ?? null,
    job: result.job ?? null,
    launcher_job: result.launcher_job ?? null,
    activity: result.activity ?? {
      cluster_id: result.cluster_id || '',
      status: 'unknown',
      count: 0,
      recent: [],
    },
  };
}

function mapSamsungPrecheckSnapshotRow(row) {
  return mapSamsungAtlasSnapshotRow(row, 'samsung_precheck');
}

function mapSamsungUpgradeSnapshotRow(row) {
  return mapSamsungAtlasSnapshotRow(row, 'samsung_upgrade');
}

function mapSamsungRollbackSnapshotRow(row) {
  return mapSamsungAtlasSnapshotRow(row, 'samsung_rollback');
}

function mapSamsungUndeploymentSnapshotRow(row) {
  return mapSamsungAtlasSnapshotRow(row, 'samsung_undeployment');
}

function mapSamsungDeploymentSnapshotRow(row) {
  return mapSamsungAtlasSnapshotRow(row, 'samsung_deployment');
}

function isSamsungPrecheckRunActive(run) {
  if (!run) return false;
  if (run.status === 'cancelled') return false;
  if (run.status === 'running' || run.status === 'pending' || run.status === 'unknown') return true;
  if (run.phase === 'monitoring' || run.phase === 'queued' || run.phase === 'running') {
    return run.status !== 'success' && run.status !== 'failed';
  }
  return false;
}

function mapStoredToStatusResponse(stored, device) {
  return {
    cluster_id: device?.cluster_id || stored.cluster_id || null,
    launcher_job_id: stored.launcher_job_id ?? null,
    monitor_job_id: stored.monitor_job_id ?? null,
    monitor_job_kind: stored.monitor_job_kind ?? null,
    job: stored.job ?? stored.launcher_job ?? null,
    launcher_job: stored.launcher_job ?? null,
    activity: stored.activity ?? {
      cluster_id: stored.cluster_id || '',
      status: 'unknown',
      count: 0,
      recent: [],
    },
    phase: stored.phase || 'complete',
    status: stored.status,
    message: stored.message,
    cancelled: stored.status === 'cancelled',
    checked_at: stored.updated_at || new Date().toISOString(),
  };
}

async function cancelSamsungAtlasRun(deviceId, operation = 'upgrade', { reason, note } = {}) {
  const op = normalizeAtlasOperation(operation);
  if (op === 'precheck') {
    const err = new Error('Cancel is only supported for upgrade, rollback, undeployment, and deployment');
    err.status = 400;
    throw err;
  }

  const device = await loadDevice(deviceId);
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }

  const stored = await loadSamsungAtlasSnapshot(deviceId, op);
  if (!stored?.launched_at) {
    const err = new Error(`No Samsung ${op} run on record for this device`);
    err.status = 404;
    throw err;
  }

  const now = new Date().toISOString();
  const cancelledReason = reason?.trim() || null;
  const message =
    cancelledReason ||
    'Cancelled on dashboard — monitoring stopped (does not change Atlas or MP job status)';

  const run = {
    ...stored,
    device_id: deviceId,
    cluster_id: device.cluster_id,
    operation: op,
    status: 'cancelled',
    phase: 'complete',
    message,
    error: note?.trim() || stored.error || null,
    cancelled_at: now,
    cancelled_reason: cancelledReason,
    updated_at: now,
  };

  await saveSamsungAtlasSnapshot(deviceId, run, op);
  return {
    device_id: deviceId,
    cluster_id: device.cluster_id,
    operation: op,
    status: 'cancelled',
    phase: 'complete',
    message,
    cancelled_at: now,
    cancelled_reason: cancelledReason,
    updated_at: now,
  };
}

async function persistSamsungAtlasStatus(deviceId, device, status, stored, operation = 'precheck') {
  const op = normalizeAtlasOperation(operation);
  // Always re-read before write: a concurrent Cancel can land while this poll
  // still holds a stale "running" snapshot. Trusting `stored` alone would
  // overwrite cancelled back to running.
  const latest = await loadSamsungAtlasSnapshot(deviceId, op);
  if (latest?.status === 'cancelled' || stored?.status === 'cancelled') return;
  const base = latest || stored || null;
  if (base?.status === 'cancelled') return;
  // A different launch timestamp means this is a new run, so none of the
  // previous run's job ids may be inherited as fallbacks below.
  const isNewSession = Boolean(
    base?.launched_at &&
      status.launched_at &&
      String(base.launched_at) !== String(status.launched_at)
  );
  const launcherJobId = isNewSession
    ? status.launcher_job_id ?? null
    : status.launcher_job_id ?? base?.launcher_job_id ?? null;
  const monitorJobId =
    isNewSession ||
    (status.launcher_job_id &&
      base?.launcher_job_id &&
      Number(status.launcher_job_id) > Number(base.launcher_job_id))
      ? status.monitor_job_id ?? null
      : status.monitor_job_id ?? base?.monitor_job_id ?? null;
  const launchedAt = status.launched_at || base?.launched_at || status.checked_at;
  const reportedBy = base?.reported_by || 'system';

  await saveSamsungAtlasSnapshot(
    deviceId,
    {
      device_id: deviceId,
      cluster_id: device?.cluster_id || base?.cluster_id,
      operation: op,
      workload: base?.workload || 'VDU',
      workload_source: base?.workload_source,
      version: base?.version || '',
      ciq_source: base?.ciq_source ?? null,
      previous_version: base?.previous_version ?? null,
      upgrade_target_version: base?.upgrade_target_version ?? null,
      template_id: base?.template_id || 0,
      job_id: base?.job_id ?? status.launcher_job_id,
      job_kind: base?.job_kind,
      launcher_job_id: launcherJobId,
      session_launcher_job_id: isNewSession
        ? status.session_launcher_job_id ?? status.launcher_job_id ?? null
        : base?.session_launcher_job_id ??
          status.session_launcher_job_id ??
          status.launcher_job_id ??
          null,
      monitor_job_id: monitorJobId,
      monitor_job_kind:
        isNewSession ||
        (status.launcher_job_id &&
          base?.launcher_job_id &&
          Number(status.launcher_job_id) > Number(base.launcher_job_id))
          ? status.monitor_job_kind ?? null
          : status.monitor_job_kind ?? base?.monitor_job_kind ?? null,
      phase: status.phase,
      status: status.status,
      message: status.message,
      job: status.job,
      launcher_job: status.launcher_job ?? base?.launcher_job ?? null,
      activity: status.activity,
      launched_at: launchedAt,
      updated_at: status.checked_at,
      error:
        status.error_report?.detail ||
        (status.status === 'failed' ? status.message : null),
      reported_by: reportedBy,
    },
    op
  );

  if (status.status === 'failed') {
    try {
      await recordSamsungIssueFailure({
        deviceId,
        clusterId: device?.cluster_id || base?.cluster_id,
        siteType: device?.site_type ?? null,
        operation: op,
        issueDescription:
          status.error_report?.detail ||
          status.message ||
          base?.error ||
          'Samsung action failed',
        launcherJobId,
        monitorJobId,
        atlasJobName:
          status.error_report?.name ||
          status.job?.name ||
          status.launcher_job?.name ||
          base?.job?.name ||
          null,
        launchedAt,
        userReporter: reportedBy,
      });
    } catch (logErr) {
      console.warn('[samsung-issue-log] failed to record status failure:', logErr.message);
    }
  }
}

async function persistSamsungPrecheckStatus(deviceId, device, status, stored) {
  return persistSamsungAtlasStatus(deviceId, device, status, stored, 'precheck');
}

async function atlasSettingsPublic() {
  const username = process.env.NETWORK_ATLAS_USERNAME?.trim() || '';
  const passwordSet = Boolean(process.env.NETWORK_ATLAS_PASSWORD);
  const bearerTokenSet = Boolean(await resolveAtlasBearerToken());
  return {
    base_url: atlasBaseUrl(),
    username,
    batch_username: batchUsername(),
    password_set: passwordSet,
    bearer_token_set: bearerTokenSet,
    auth_mode: bearerTokenSet ? 'bearer' : passwordSet && username ? 'basic' : 'none',
    configured: await atlasAuthConfiguredAsync(),
    udu_template_id: UDU_TEMPLATE,
    vdu_template_id: VDU_TEMPLATE,
    udu_undeploy_template_id: UDU_UNDEPLOY_TEMPLATE,
    vdu_undeploy_template_id: VDU_UNDEPLOY_TEMPLATE,
    udu_deploy_template_id: UDU_DEPLOY_TEMPLATE,
    vdu_deploy_template_id: VDU_DEPLOY_TEMPLATE,
    default_version: process.env.NETWORK_ATLAS_DEFAULT_VERSION?.trim() || '',
    ciq_sources: [...ATLAS_CIQ_SOURCES],
    default_ciq_source: defaultCiqSource(),
  };
}

module.exports = {
  runSamsungAtlasJob,
  runSamsungPrecheck,
  runSamsungUpgrade,
  runSamsungRollback,
  runSamsungUndeployment,
  runSamsungDeployment,
  resolveRollbackVersion,
  cancelSamsungAtlasRun,
  mapStoredToStatusResponse,
  getSamsungPrecheckStatus,
  saveSamsungAtlasSnapshot,
  saveSamsungPrecheckSnapshot,
  loadSamsungAtlasSnapshot,
  loadSamsungPrecheckSnapshot,
  persistSamsungAtlasStatus,
  persistSamsungPrecheckStatus,
  mapSamsungPrecheckSnapshotRow,
  mapSamsungUpgradeSnapshotRow,
  mapSamsungRollbackSnapshotRow,
  mapSamsungUndeploymentSnapshotRow,
  mapSamsungDeploymentSnapshotRow,
  normalizeAtlasOperation,
  isSamsungPrecheckRunActive,
  fetchActivityStream,
  atlasFetchDirect,
  detectSamsungWorkload,
  detectSamsungWorkloadFromHints,
  isSamsungApplication,
  atlasSettingsPublic,
  setAtlasBearerToken,
  resolveAtlasBearerToken,
  isLauncherJobName,
  isAtlasLauncherJobName,
  isAtlasWrapperJobName,
  isPrecheckWrapperJobName,
  inferWorkloadFromJobName,
  jobBelongsToAtlasRun,
  findWrapperJobInActivity,
  findWorkflowJobInActivity,
  findMonitorJobViaJobsApi,
  findLatestLauncherJobForCluster,
  enrichJobFailureDetail,
  resolveNestedRootCauseJob,
  mergeSessionActivity,
  resolveSessionLauncherId,
  jobPredatesRun,
  extractFailureDetailFromStdout,
  findFailedWorkflowChildJob,
  mergePrecheckStatus,
  ATLAS_CIQ_SOURCES,
  normalizeCiqSource,
  buildDeploymentPayload,
};
