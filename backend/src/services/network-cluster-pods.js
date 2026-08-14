const fs = require('fs');
const db = require('../db');
const { getWrSubcloudCredentials } = require('./network-credentials');
const { execSshRemote } = require('./network-wr-ssh');
const {
  loadDevice,
  kubeconfigPath,
  normalizeOs,
  shouldUseHostAgent,
  kubectlJson,
} = require('./network-subcloud-precheck');
const { attachBuildInfo } = require('./network-buildinfo');
const { trackPodResultInBackground } = require('./network-samsung-software-tracker');

const { hostAgentBaseUrl, hostAgentHeaders } = require('./network-host-agent');

function validK8sName(name) {
  const n = String(name || '').trim();
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(n) && n.length <= 253;
}

function mapPod(item) {
  const containers = item.status?.containerStatuses || [];
  const readyCount = containers.filter((c) => c.ready).length;
  const total = containers.length || (item.spec?.containers || []).length;
  const restarts = containers.reduce((sum, c) => sum + (c.restartCount || 0), 0);
  const waiting = containers
    .map((c) => c.state?.waiting?.reason)
    .filter(Boolean)
    .join(', ');
  return {
    name: item.metadata?.name || '',
    namespace: item.metadata?.namespace || '',
    phase: item.status?.phase || 'Unknown',
    ready: total > 0 ? `${readyCount}/${total}` : '—',
    restarts,
    node: item.spec?.nodeName || null,
    started_at: item.status?.startTime || null,
    reason: waiting || null,
  };
}

function summarizePods(pods) {
  const running = pods.filter((p) => p.phase === 'Running').length;
  const notRunning = pods.length - running;
  return { total: pods.length, running, not_running: notRunning };
}

async function listRhocpNamespacePods(device, namespace) {
  const kubeconfig = kubeconfigPath(device.cluster_name);
  if (!kubeconfig || !fs.existsSync(kubeconfig)) {
    const err = new Error(
      `Missing kubeconfig ${device.cluster_name ? `${device.cluster_name}.kubeconfig` : '(no cluster name)'}`
    );
    err.status = 400;
    throw err;
  }

  const list = await kubectlJson(kubeconfig, ['get', 'pods', '-n', namespace]);
  const pods = (list.items || []).map(mapPod);
  const result = {
    device_id: device.id,
    cluster_id: device.cluster_id,
    cluster_name: device.cluster_name,
    cluster_namespace: namespace,
    platform: 'RHOCP',
    ...summarizePods(pods),
    pods,
    fetched_at: new Date().toISOString(),
    via: 'kubectl',
  };
  return attachBuildInfo(result, { platform: 'RHOCP', kubeconfig });
}

async function listWrNamespacePods(device, namespace) {
  if (!device.subcloud_ip?.trim()) {
    const err = new Error('Device has no Subcloud IP');
    err.status = 400;
    throw err;
  }

  const creds = await getWrSubcloudCredentials(device.parent_controller);
  if (!creds.configured) {
    const err = new Error(
      device.parent_controller
        ? `Configure SSH for Parent Central Controller "${device.parent_controller}"`
        : 'Configure Wind River SSH in Network → Settings'
    );
    err.status = 400;
    throw err;
  }

  const script = [
    'source /etc/platform/openrc',
    'for kc in "$KUBECONFIG" /etc/kubernetes/admin.conf /root/.kube/config "$HOME/.kube/config"; do',
    '  if [ -n "$kc" ] && [ -f "$kc" ]; then export KUBECONFIG="$kc"; break; fi',
    'done',
    `kubectl get pods -n ${namespace} -o json --request-timeout=45s`,
  ].join('\n');
  const scriptB64 = Buffer.from(script, 'utf8').toString('base64');
  const wrapped = `bash -l -c ${JSON.stringify(`echo ${scriptB64} | base64 -d | bash -l`)}`;
  const output = await execSshRemote(
    device.subcloud_ip,
    creds.username,
    creds.password,
    creds.keyPath,
    wrapped
  );

  let list;
  try {
    list = JSON.parse(output);
  } catch {
    const err = new Error(output.trim().slice(0, 240) || 'Invalid kubectl JSON from subcloud');
    err.status = 502;
    throw err;
  }

  const pods = (list.items || []).map(mapPod);
  const result = {
    device_id: device.id,
    cluster_id: device.cluster_id,
    cluster_name: device.cluster_name,
    cluster_namespace: namespace,
    platform: 'Wind River',
    ...summarizePods(pods),
    pods,
    fetched_at: new Date().toISOString(),
    via: 'wr-ssh',
  };
  return attachBuildInfo(result, { platform: 'Wind River', device, creds });
}

async function listDevicePodsDirect(deviceId) {
  const device = await loadDevice(deviceId);
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }

  const namespace = device.cluster_namespace?.trim();
  if (!namespace) {
    const err = new Error('Device has no cluster namespace — sync from Drive or middleware');
    err.status = 400;
    throw err;
  }
  if (!validK8sName(namespace)) {
    const err = new Error(`Invalid cluster namespace "${namespace}"`);
    err.status = 400;
    throw err;
  }

  const platform = normalizeOs(device.os);
  if (platform === 'Wind River') {
    return listWrNamespacePods(device, namespace);
  }
  if (platform === 'RHOCP' || device.cluster_name) {
    return listRhocpNamespacePods(device, namespace);
  }

  const err = new Error(
    device.os ? `Unsupported OS "${device.os}" for pod listing` : 'Set OS in vDU_List (RHOCP or Wind River)'
  );
  err.status = 400;
  throw err;
}

async function listDevicePodsViaHostAgent(deviceId) {
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${base}/pods?device_id=${encodeURIComponent(deviceId)}`, {
      headers: hostAgentHeaders(),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Host pods fetch failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { ...body, via: 'host-agent' };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Pod listing timed out after 120s');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function listDevicePods(deviceId) {
  let result;
  if (shouldUseHostAgent()) {
    try {
      result = await listDevicePodsViaHostAgent(deviceId);
    } catch (err) {
      if (err.status !== 404) throw err;
      result = await listDevicePodsDirect(deviceId);
    }
  } else {
    result = await listDevicePodsDirect(deviceId);
  }
  trackPodResultInBackground(deviceId, result);
  return result;
}

async function listAllClusterPods() {
  const { rows } = await db.query(
    `SELECT id, cluster_id, cluster_name, cluster_namespace, os, subcloud_ip, parent_controller
     FROM network_devices
     WHERE cluster_namespace IS NOT NULL AND TRIM(cluster_namespace) <> ''
     ORDER BY cluster_id ASC`
  );

  const results = await Promise.all(
    rows.map(async (device) => {
      try {
        const result = await listDevicePodsDirect(device.id);
        trackPodResultInBackground(device.id, result);
        return result;
      } catch (err) {
        return {
          device_id: device.id,
          cluster_id: device.cluster_id,
          cluster_name: device.cluster_name,
          cluster_namespace: device.cluster_namespace,
          platform: normalizeOs(device.os) || device.os || null,
          total: 0,
          running: 0,
          not_running: 0,
          pods: [],
          error: err.message,
          fetched_at: new Date().toISOString(),
        };
      }
    })
  );

  return { clusters: results, fetched_at: new Date().toISOString() };
}

async function listAllClusterPodsViaHost() {
  const base = hostAgentBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${base}/pods`, {
      headers: hostAgentHeaders(),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Host pods fetch failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function listClusterPods() {
  if (shouldUseHostAgent()) {
    try {
      return await listAllClusterPodsViaHost();
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  return listAllClusterPods();
}

module.exports = {
  listDevicePods,
  listDevicePodsDirect,
  listClusterPods,
  listAllClusterPods,
  mapPod,
  validK8sName,
};
