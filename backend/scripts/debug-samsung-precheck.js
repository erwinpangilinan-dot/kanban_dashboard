/**
 * Debug Samsung Atlas precheck for a gNB DUID or device UUID.
 * Usage: node backend/scripts/debug-samsung-precheck.js 29991572163
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
process.env.DATABASE_URL =
  process.env.NETWORK_HOST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kanban:kanban@localhost:5432/mission_control';

const db = require('../src/db');
const { listDevicePods } = require('../src/services/network-cluster-pods');
const {
  detectSamsungWorkloadFromHints,
  atlasSettingsPublic,
} = require('../src/services/network-samsung-precheck');

const atlasBaseUrl = () =>
  (process.env.NETWORK_ATLAS_BASE_URL || 'http://me.atlas.automation.vzwnet.com').replace(/\/$/, '');

async function loadDeviceByKey(key) {
  const { rows } = await db.query(
    `SELECT * FROM network_devices WHERE cluster_id = $1 OR id::text = $1 LIMIT 1`,
    [key]
  );
  return rows[0] || null;
}

async function testAtlasAuth() {
  const user = process.env.NETWORK_ATLAS_USERNAME?.trim();
  const pass = process.env.NETWORK_ATLAS_PASSWORD;
  if (!user || !pass) return { ok: false, step: 'env', error: 'missing credentials' };

  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const base = atlasBaseUrl();

  const payload = {
    extra_vars: {
      batch_list: [
        {
          userName: process.env.NETWORK_ATLAS_BATCH_USERNAME?.trim() || user,
          batch_id: '1',
          batch_priority: 1,
          scheduled_run_date: '2026-08-06 18:00:00 UTC',
          operation: 'precheck',
          version: 'DEBUG-TEST',
          gnblist: ['29991572163'],
        },
      ],
    },
  };

  const attempts = [];

  // 1) MOP style: Basic auth directly on launch
  try {
    const launchRes = await fetch(`${base}/api/v2/job_templates/7491/launch/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(payload),
    });
    const launchText = await launchRes.text();
    let launchJson;
    try {
      launchJson = launchText ? JSON.parse(launchText) : {};
    } catch {
      launchJson = { raw: launchText.slice(0, 500) };
    }
    attempts.push({
      mode: 'basic_launch',
      ok: launchRes.ok,
      status: launchRes.status,
      job_id: launchJson.job ?? launchJson.id ?? null,
      error: launchRes.ok ? null : launchJson.detail || launchJson.error || launchJson.raw,
    });
    if (launchRes.ok) {
      return { ok: true, step: 'basic_launch', job_id: launchJson.job ?? launchJson.id, attempts };
    }
  } catch (err) {
    attempts.push({ mode: 'basic_launch', ok: false, error: err.message });
  }

  // 2) Token then Bearer launch
  try {
    const tokenRes = await fetch(`${base}/api/v2/tokens/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: 'debug-samsung-precheck', application: null }),
    });
    const tokenText = await tokenRes.text();
    let tokenJson;
    try {
      tokenJson = tokenText ? JSON.parse(tokenText) : {};
    } catch {
      tokenJson = { raw: tokenText.slice(0, 200) };
    }
    if (!tokenRes.ok) {
      attempts.push({
        mode: 'token',
        ok: false,
        status: tokenRes.status,
        error: tokenJson.detail || tokenJson.raw,
      });
      return { ok: false, step: 'auth', attempts };
    }

    const launchRes = await fetch(`${base}/api/v2/job_templates/7491/launch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenJson.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const launchText = await launchRes.text();
    let launchJson;
    try {
      launchJson = launchText ? JSON.parse(launchText) : {};
    } catch {
      launchJson = { raw: launchText.slice(0, 500) };
    }
    attempts.push({
      mode: 'bearer_launch',
      ok: launchRes.ok,
      status: launchRes.status,
      job_id: launchJson.job ?? launchJson.id ?? null,
      error: launchRes.ok ? null : launchJson.detail || launchJson.error || launchJson.raw,
    });
    return {
      ok: launchRes.ok,
      step: launchRes.ok ? 'bearer_launch' : 'launch',
      job_id: launchJson.job ?? launchJson.id ?? null,
      attempts,
    };
  } catch (err) {
    attempts.push({ mode: 'token_or_bearer', ok: false, error: err.message });
    return { ok: false, step: 'network', error: err.message, attempts };
  }
}

async function main() {
  const key = process.argv[2] || '29991572163';
  const device = await loadDeviceByKey(key);
  if (!device) {
    console.error('Device not found for', key);
    process.exit(1);
  }

  console.log('Device:', device.cluster_id, device.id);
  console.log('Atlas settings:', await atlasSettingsPublic());

  let podResult;
  try {
    podResult = await listDevicePods(device.id);
    console.log('Pods:', podResult.total, 'running', podResult.running, 'via', podResult.via);
    console.log('Software:', podResult.software_version);
    console.log(
      'Sample pods:',
      (podResult.pods || []).slice(0, 3).map((p) => p.name)
    );
  } catch (err) {
    console.log('Pod fetch error:', err.message);
    podResult = { pods: [] };
  }

  const detected = detectSamsungWorkloadFromHints({
    pods: podResult?.pods,
    clusterId: device.cluster_id,
    softwareVersion: podResult?.software_version,
    buildInfo: podResult?.build_info,
    modelType: device.model_type,
  });
  console.log('Detected workload:', detected);

  const atlas = await testAtlasAuth();
  console.log('Atlas direct:', JSON.stringify(atlas, null, 2));

  try {
    const launchBody = {
      extra_vars: {
        batch_list: [
          {
            userName: process.env.NETWORK_ATLAS_BATCH_USERNAME?.trim() || process.env.NETWORK_ATLAS_USERNAME,
            batch_id: '1',
            batch_priority: 1,
            scheduled_run_date: '2026-08-06 18:00:00 UTC',
            operation: 'precheck',
            version: 'DEBUG-TEST',
            gnblist: [device.cluster_id],
          },
        ],
      },
    };
    const viaHost = await fetch('http://127.0.0.1:38765/atlas/api/v2/job_templates/7491/launch/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(launchBody),
    });
    const viaHostText = await viaHost.text();
    let viaHostJson;
    try {
      viaHostJson = viaHostText ? JSON.parse(viaHostText) : {};
    } catch {
      viaHostJson = { raw: viaHostText.slice(0, 300) };
    }
    console.log(
      'Atlas via host agent:',
      JSON.stringify(
        {
          ok: viaHost.ok,
          status: viaHost.status,
          job_id: viaHostJson.job ?? viaHostJson.id ?? null,
          error: viaHost.ok ? null : viaHostJson.error || viaHostJson.detail,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log('Atlas via host agent: unreachable —', err.message);
  }

  process.exit(atlas.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
