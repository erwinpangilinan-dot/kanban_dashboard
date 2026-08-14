const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { probeSubcloud } = require('./network-probe');
const { getWrSubcloudCredentials } = require('./network-credentials');
const { writePrecheckLog, precheckLogRoot } = require('./network-precheck-log');
const {
  getCustomPrecheckCommandsForPlatform,
  parseKubectlArgs,
  evaluateCustomOutput,
} = require('./network-precheck-custom');
const {
  runWrRemotePrecheck,
  parseHostList,
  parseAlarms,
  parseSoftwareList,
  parseKubectlNodes,
  parseVduNamespaces,
  extractSection,
} = require('./network-wr-ssh');

const execFileAsync = promisify(execFile);

const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');

function shouldUseHostAgent() {
  return (
    process.env.NETWORK_SKIP_CONTAINER_POLLER === '1' ||
    process.env.NETWORK_PRECHECK_VIA_HOST === '1'
  );
}

function kubeconfigDir() {
  // Defaults to a gitignored directory: kubeconfigs embed client certs and keys,
  // so the repo root is the wrong place for them.
  return (
    process.env.NETWORK_KUBECONFIG_DIR ||
    path.join(__dirname, '../../../secrets/kubeconfigs')
  );
}

function kubectlBin() {
  if (process.env.KUBECTL_PATH) return process.env.KUBECTL_PATH;
  if (process.platform === 'win32') {
    const dockerKubectl = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\kubectl.exe';
    if (fs.existsSync(dockerKubectl)) return dockerKubectl;
  }
  return 'kubectl';
}

function kubeconfigPath(clusterName) {
  if (!clusterName?.trim()) return null;
  return path.join(kubeconfigDir(), `${clusterName.trim()}.kubeconfig`);
}

function normalizeOs(os) {
  const v = (os || '').trim().toLowerCase();
  if (v.includes('rhocp') || v.includes('openshift') || v === 'ocp') return 'RHOCP';
  if (v.includes('wind') || v.includes('wrcp')) return 'Wind River';
  return os?.trim() || null;
}

async function loadDevice(deviceId) {
  const { rows } = await db.query(
    `SELECT d.*,
            sc.reachable AS subcloud_reachable,
            sc.latency_ms AS subcloud_latency_ms,
            sc.error AS subcloud_error
     FROM network_devices d
     LEFT JOIN network_subcloud_snapshots sc ON sc.device_id = d.id
     WHERE d.id = $1`,
    [deviceId]
  );
  return rows[0] || null;
}

async function kubectlJson(kubeconfig, args) {
  const stdout = await kubectl(kubeconfig, [...args, '-o', 'json']);
  return JSON.parse(stdout);
}

async function kubectl(kubeconfig, args) {
  const bin = kubectlBin();
  const { stdout } = await execFileAsync(
    bin,
    ['--kubeconfig', kubeconfig, '--insecure-skip-tls-verify', ...args],
    { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }
  );
  return stdout.trim();
}

function check(id, label, status, detail) {
  return { id, label, status, detail: detail || null };
}

function overallStatus(checks) {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

async function runRhocpPrecheck(device, kubeconfig) {
  const checks = [];

  const ping = device.subcloud_ip
    ? await probeSubcloud(device.subcloud_ip)
    : { reachable: false, latency_ms: null, error: 'No subcloud IP' };
  checks.push(
    check(
      'subcloud_reachability',
      'Subcloud IP reachable',
      ping.reachable ? 'pass' : 'fail',
      ping.reachable ? `${ping.latency_ms} ms` : ping.error || 'Unreachable'
    )
  );

  if (!fs.existsSync(kubeconfig)) {
    checks.push(
      check(
        'kubeconfig',
        'Kubeconfig present',
        'fail',
        `Missing ${path.basename(kubeconfig)} in ${kubeconfigDir()}`
      )
    );
    return buildResult(device, 'RHOCP', checks);
  }

  checks.push(
    check('kubeconfig', 'Kubeconfig present', 'pass', path.basename(kubeconfig))
  );

  let context;
  try {
    context = await kubectl(kubeconfig, ['config', 'current-context']);
    checks.push(check('api_login', 'API login', 'pass', context));
  } catch (err) {
    checks.push(check('api_login', 'API login', 'fail', err.message));
    return buildResult(device, 'RHOCP', checks);
  }

  try {
    const nodes = await kubectlJson(kubeconfig, ['get', 'nodes']);
    const items = nodes.items || [];
    const ready = items.filter((n) =>
      (n.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True')
    ).length;
    const total = items.length;
    checks.push(
      check(
        'nodes',
        'Nodes Ready',
        ready === total && total > 0 ? 'pass' : total === 0 ? 'warn' : 'fail',
        `${ready}/${total} Ready`
      )
    );
  } catch (err) {
    checks.push(check('nodes', 'Nodes Ready', 'fail', err.message));
  }

  try {
    const co = await kubectlJson(kubeconfig, ['get', 'co']);
    const items = co.items || [];
    const bad = items.filter((op) => {
      const avail = op.status?.conditions?.find((c) => c.type === 'Available');
      const deg = op.status?.conditions?.find((c) => c.type === 'Degraded');
      return avail?.status === 'False' || deg?.status === 'True';
    });
    checks.push(
      check(
        'cluster_operators',
        'ClusterOperators healthy',
        bad.length === 0 ? 'pass' : 'fail',
        bad.length === 0
          ? `${items.length}/${items.length} Available`
          : `${bad.length} degraded: ${bad.map((o) => o.metadata?.name).join(', ')}`
      )
    );
  } catch (err) {
    checks.push(check('cluster_operators', 'ClusterOperators healthy', 'fail', err.message));
  }

  try {
    const cv = await kubectlJson(kubeconfig, ['get', 'clusterversion', 'version']);
    const version = cv.status?.desired?.version || cv.spec?.desiredUpdate?.version || '—';
    const avail = cv.status?.conditions?.find((c) => c.type === 'Available');
    const prog = cv.status?.conditions?.find((c) => c.type === 'Progressing');
    const ok = avail?.status === 'True' && prog?.status !== 'True';
    checks.push(
      check(
        'cluster_version',
        'Cluster version',
        ok ? 'pass' : 'warn',
        `${version}${prog?.status === 'True' ? ' (upgrading)' : ''}`
      )
    );
  } catch (err) {
    checks.push(check('cluster_version', 'Cluster version', 'warn', err.message));
  }

  try {
    const mcp = await kubectlJson(kubeconfig, ['get', 'mcp']);
    const updating = (mcp.items || []).filter((p) => p.status?.conditions?.some(
      (c) => c.type === 'Updating' && c.status === 'True'
    ));
    checks.push(
      check(
        'machine_config_pools',
        'MachineConfigPools updated',
        updating.length === 0 ? 'pass' : 'warn',
        updating.length === 0
          ? `${(mcp.items || []).length} pool(s) idle`
          : `Updating: ${updating.map((p) => p.metadata?.name).join(', ')}`
      )
    );
  } catch (err) {
    checks.push(check('machine_config_pools', 'MachineConfigPools updated', 'warn', err.message));
  }

  try {
    const pods = await kubectlJson(kubeconfig, [
      'get',
      'pods',
      '-A',
      '--field-selector=status.phase!=Running,status.phase!=Succeeded',
    ]);
    const count = (pods.items || []).length;
    checks.push(
      check(
        'non_running_pods',
        'Non-running pods',
        count === 0 ? 'pass' : 'warn',
        count === 0 ? 'None' : `${count} pod(s) not Running/Succeeded`
      )
    );
  } catch (err) {
    checks.push(check('non_running_pods', 'Non-running pods', 'warn', err.message));
  }

  try {
    const ns = await kubectlJson(kubeconfig, ['get', 'ns']);
    const gnbNs = (ns.items || [])
      .map((n) => n.metadata?.name)
      .filter((name) => name && /gnb/i.test(name));
    checks.push(
      check(
        'gnb_namespaces',
        'gNB namespaces',
        gnbNs.length > 0 ? 'pass' : 'warn',
        gnbNs.length > 0 ? gnbNs.join(', ') : 'No namespace containing gnb'
      )
    );

    if (gnbNs.length > 0) {
      let workloadPods = 0;
      for (const name of gnbNs) {
        try {
          const pl = await kubectlJson(kubeconfig, ['get', 'pods', '-n', name]);
          workloadPods += (pl.items || []).length;
        } catch {
          /* skip */
        }
      }
      checks.push(
        check(
          'gnb_workloads',
          'gNB workloads',
          workloadPods > 0 ? 'pass' : 'warn',
          workloadPods > 0 ? `${workloadPods} pod(s) in gNB namespace(s)` : 'Namespaces empty'
        )
      );
    }
  } catch (err) {
    checks.push(check('gnb_namespaces', 'gNB namespaces', 'warn', err.message));
  }

  let customSections = [];
  if (fs.existsSync(kubeconfig)) {
    try {
      customSections = await runRhocpCustomChecks(kubeconfig, checks);
    } catch {
      /* custom checks optional */
    }
  }

  return buildResult(device, 'RHOCP', checks, { customSections });
}

function buildResult(device, platform, checks, logExtras) {
  const status = overallStatus(checks);
  const summary =
    status === 'pass'
      ? 'Subcloud precheck passed'
      : status === 'warn'
        ? 'Subcloud precheck passed with warnings'
        : 'Subcloud precheck failed';
  const result = {
    device_id: device.id,
    cluster_id: device.cluster_id,
    cluster_name: device.cluster_name,
    platform,
    status,
    summary,
    checks,
    checked_at: new Date().toISOString(),
  };
  if (logExtras) result._logExtras = logExtras;
  return result;
}

function parseCustomWrSections(output, customCommands) {
  const checks = [];
  const customSections = [];
  for (const cmd of customCommands) {
    const text = extractSection(output, `custom-${cmd.id}`);
    const ev = evaluateCustomOutput(text);
    checks.push(check(`custom_${cmd.id}`, `Custom: ${cmd.label}`, ev.status, ev.detail));
    customSections.push({ label: cmd.label, command: cmd.command, output: text || ev.output || '' });
  }
  return { checks, customSections };
}

async function runRhocpCustomChecks(kubeconfig, checks) {
  const customCommands = await getCustomPrecheckCommandsForPlatform('RHOCP');
  const customSections = [];
  for (const cmd of customCommands) {
    try {
      const args = parseKubectlArgs(cmd.command);
      const out = await kubectl(kubeconfig, args);
      const ev = evaluateCustomOutput(out);
      checks.push(check(`custom_${cmd.id}`, `Custom: ${cmd.label}`, ev.status, ev.detail));
      customSections.push({ label: cmd.label, command: cmd.command, output: out });
    } catch (err) {
      checks.push(check(`custom_${cmd.id}`, `Custom: ${cmd.label}`, 'fail', err.message));
      customSections.push({ label: cmd.label, command: cmd.command, output: err.message });
    }
  }
  return customSections;
}

async function runWindRiverPrecheck(device) {
  const checks = [];
  const ping = device.subcloud_ip
    ? await probeSubcloud(device.subcloud_ip)
    : { reachable: false, latency_ms: null, error: 'No subcloud IP' };
  checks.push(
    check(
      'subcloud_reachability',
      'Subcloud IP reachable',
      ping.reachable ? 'pass' : 'fail',
      ping.reachable ? `${ping.latency_ms} ms` : ping.error || 'Unreachable'
    )
  );

  if (!ping.reachable) {
    return buildResult(device, 'Wind River', checks);
  }

  const creds = await getWrSubcloudCredentials(device.parent_controller);
  if (!creds.configured) {
    const hint = device.parent_controller
      ? `Configure SSH for Parent Central Controller "${device.parent_controller}" in Network → Settings`
      : 'Configure Network → Settings → Wind River SSH, or set NETWORK_WR_SSH_KEY_PATH';
    checks.push(
      check(
        'wr_ssh',
        'WR SSH credentials',
        'fail',
        hint
      )
    );
    return buildResult(device, 'Wind River', checks);
  }

  const credDetail =
    creds.source === 'controller'
      ? `${creds.username} · ${creds.parent_controller}`
      : creds.keyPath
        ? 'SSH key (default)'
        : `${creds.username} (default fallback)`;
  checks.push(check('wr_ssh', 'WR SSH credentials', 'pass', credDetail));

  const customCommands = await getCustomPrecheckCommandsForPlatform('Wind River');

  let output;
  try {
    output = await runWrRemotePrecheck(device.subcloud_ip, creds, customCommands);
    checks.push(check('wr_ssh_login', 'SSH login + openrc', 'pass', device.subcloud_ip));
  } catch (err) {
    checks.push(check('wr_ssh_login', 'SSH login + openrc', 'fail', err.message));
    return buildResult(device, 'Wind River', checks);
  }

  try {
    const hosts = parseHostList(output);
    const hostOk =
      hosts.total > 0 && (hosts.available === hosts.total || hosts.available > 0);
    checks.push(
      check(
        'host_list',
        'system host-list',
        hosts.total === 0 ? 'warn' : hostOk ? 'pass' : 'fail',
        hosts.total === 0
          ? 'No hosts parsed'
          : `${hosts.available}/${hosts.total} available`
      )
    );
  } catch (err) {
    checks.push(check('host_list', 'system host-list', 'fail', err.message));
  }

  try {
    const alarms = parseAlarms(output);
    const alarmStatus =
      alarms.critical > 0 ? 'fail' : alarms.major > 0 ? 'warn' : 'pass';
    checks.push(
      check(
        'alarms',
        'fm alarm-list',
        alarmStatus,
        alarms.critical || alarms.major
          ? `critical=${alarms.critical} major=${alarms.major}`
          : alarms.hasRows
            ? 'No critical/major'
            : 'No alarms'
      )
    );
  } catch (err) {
    checks.push(check('alarms', 'fm alarm-list', 'warn', err.message));
  }

  try {
    const sw = parseSoftwareList(output);
    const multipleDeployed = (sw.deployedReleases?.length || 0) > 1;
    checks.push(
      check(
        'software',
        'software list',
        sw.rows.length > 0 ? (multipleDeployed ? 'warn' : 'pass') : 'warn',
        sw.detail || (sw.raw?.trim() ? sw.raw.trim().slice(0, 120) : 'No output')
      )
    );
  } catch (err) {
    checks.push(check('software', 'software list', 'warn', err.message));
  }

  try {
    const apps = extractSection(output, 'applications');
    const appLines = apps.split('\n').filter((l) => l.includes('|')).length;
    checks.push(
      check(
        'applications',
        'system application-list',
        appLines > 0 ? 'pass' : 'warn',
        appLines > 0 ? `${appLines} application row(s)` : 'No applications parsed'
      )
    );
  } catch (err) {
    checks.push(check('applications', 'system application-list', 'warn', err.message));
  }

  try {
    const nodes = parseKubectlNodes(output);
    const nodeDetail =
      nodes.total > 0
        ? `${nodes.ready}/${nodes.total} Ready`
        : nodes.raw?.trim()
          ? nodes.raw.trim().slice(0, 120)
          : 'No nodes parsed';
    checks.push(
      check(
        'k8s_nodes',
        'kubectl nodes Ready',
        nodes.total > 0 && nodes.ready === nodes.total
          ? 'pass'
          : nodes.total === 0
            ? 'warn'
            : 'fail',
        nodeDetail
      )
    );
  } catch (err) {
    checks.push(check('k8s_nodes', 'kubectl nodes Ready', 'fail', err.message));
  }

  try {
    const vdu = parseVduNamespaces(output, device.cluster_id);
    const vduDetail =
      vdu.vduNs.length > 0
        ? vdu.vduNs.join(', ')
        : vdu.raw?.trim()
          ? vdu.raw.trim().slice(0, 120)
          : 'No namespace containing vdu';
    checks.push(
      check(
        'vdu_namespaces',
        'vDU namespaces',
        vdu.vduNs.length > 0 ? 'pass' : 'warn',
        vduDetail
      )
    );
  } catch (err) {
    checks.push(check('vdu_namespaces', 'vDU namespaces', 'warn', err.message));
  }

  const custom = parseCustomWrSections(output, customCommands);
  checks.push(...custom.checks);

  return buildResult(device, 'Wind River', checks, {
    rawWrOutput: output,
    customSections: custom.customSections,
  });
}

async function runPrecheckForDevice(device) {
  const platform = normalizeOs(device.os);
  if (platform === 'Wind River') {
    return runWindRiverPrecheck(device);
  }
  if (platform === 'RHOCP' || device.cluster_name) {
    const kc = kubeconfigPath(device.cluster_name);
    return runRhocpPrecheck(device, kc);
  }
  const checks = [
    check(
      'platform',
      'Platform identified',
      'fail',
      device.os ? `Unknown OS "${device.os}"` : 'Set OS column in vDU_List (RHOCP or Wind River)'
    ),
  ];
  return buildResult(device, device.os || 'unknown', checks);
}

async function savePrecheckSnapshot(deviceId, result) {
  await db.query(
    `INSERT INTO network_subcloud_precheck_snapshots
       (device_id, status, platform, result, error, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (device_id) DO UPDATE SET
       status = EXCLUDED.status,
       platform = EXCLUDED.platform,
       result = EXCLUDED.result,
       error = EXCLUDED.error,
       checked_at = EXCLUDED.checked_at`,
    [
      deviceId,
      result.status,
      result.platform,
      JSON.stringify(result),
      result.error || null,
      result.checked_at,
    ]
  );
}

async function finalizePrecheckResult(device, result) {
  const logExtras = result._logExtras || {};
  delete result._logExtras;
  try {
    const log = writePrecheckLog(device, result, logExtras);
    result.log_file = log.relativePath;
  } catch (err) {
    result.log_file = null;
    result.log_error = err.message;
  }
  return result;
}

async function precheckDeviceDirect(deviceId) {
  const device = await loadDevice(deviceId);
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }
  if (!device.subcloud_ip?.trim()) {
    const err = new Error('Device has no Subcloud IP in inventory');
    err.status = 400;
    throw err;
  }

  let result;
  try {
    result = await runPrecheckForDevice(device);
    result.via = 'api';
  } catch (err) {
    result = {
      device_id: device.id,
      cluster_id: device.cluster_id,
      cluster_name: device.cluster_name,
      platform: normalizeOs(device.os),
      status: 'fail',
      summary: 'Precheck error',
      checks: [],
      error: err.message,
      checked_at: new Date().toISOString(),
      via: 'api',
    };
  }

  result = await finalizePrecheckResult(device, result);
  await savePrecheckSnapshot(deviceId, result);
  return result;
}

function isHostAgentUnreachable(err) {
  const msg = String(err?.message || err?.cause?.message || '');
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ECONNABORTED|socket hang up/i.test(msg);
}

async function checkHostAgentHealth() {
  if (!shouldUseHostAgent()) {
    return { ok: true, required: false, url: hostAgentBaseUrl() };
  }
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${base}/health`, {
      headers: hostAgentHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, required: true, url: base, error: `Host agent HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: Boolean(body.ok), required: true, url: base, role: body.role || null };
  } catch (err) {
    return {
      ok: false,
      required: true,
      url: base,
      error: isHostAgentUnreachable(err)
        ? 'Host network poller not running'
        : err.message || 'Host agent unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function precheckDeviceViaHostAgent(deviceId) {
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${base}/precheck`, {
      method: 'POST',
      headers: hostAgentHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ device_id: deviceId }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Host precheck failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { ...body, via: 'host-agent' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Precheck timed out after 180s');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (isHostAgentUnreachable(err)) {
      const agentErr = new Error(
        'Host network poller is not running. Run .\\scripts\\start-network-host-poller.ps1 (or .\\scripts\\start-windows.ps1), then retry precheck.'
      );
      agentErr.status = 503;
      throw agentErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function precheckDevice(deviceId) {
  if (shouldUseHostAgent()) {
    try {
      return await precheckDeviceViaHostAgent(deviceId);
    } catch (err) {
      if (err.status === 404 && /not found/i.test(err.message || '')) {
        /* host agent may be old — fall through */
      } else {
        throw err;
      }
    }
  }
  return precheckDeviceDirect(deviceId);
}

module.exports = {
  precheckDevice,
  precheckDeviceDirect,
  loadDevice,
  kubeconfigPath,
  normalizeOs,
  precheckLogRoot,
  checkHostAgentHealth,
  shouldUseHostAgent,
  kubectl,
  kubectlJson,
};
