const { execFile } = require('child_process');
const { promisify } = require('util');
const { kubectlBin } = require('./network-subcloud-precheck');
const { execSshRemote } = require('./network-wr-ssh');

const execFileAsync = promisify(execFile);

/** Running pod whose name contains "dmp" (e.g. dmp0 / dmpo workloads). */
function pickDmpPod(pods) {
  return (pods || []).find(
    (p) => p.phase === 'Running' && /dmp/i.test(p.name)
  );
}

function parseBuildInfoFields(content) {
  const fields = {};
  for (const line of String(content || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

function parseBuildInfoOutput(text) {
  const cleaned = String(text || '')
    .split('\n')
    .filter((line) => !/^Defaulted container /i.test(line.trim()))
    .join('\n');
  const files = [];
  const parts = cleaned.split(/===FILE:(.+?)===\r?\n?/);
  for (let i = 1; i < parts.length; i += 2) {
    const filePath = parts[i].trim();
    const content = (parts[i + 1] || '').split(/===FILE:/)[0].trim();
    if (!filePath) continue;
    files.push({ path: filePath, fields: parseBuildInfoFields(content) });
  }
  if (!files.length && cleaned.trim()) {
    files.push({ path: '/pkg/BuildInfo', fields: parseBuildInfoFields(cleaned) });
  }
  return files;
}

function summarizeBuildInfo(files) {
  if (!files?.length) return null;
  const merged = {};
  for (const file of files) {
    Object.assign(merged, file.fields || {});
  }
  const version =
    merged.CUS_VER || merged.PAT_VER || merged.PKG_VER || merged.REL_VER || merged.SW_NAME || null;
  return {
    version,
    fields: merged,
    files,
  };
}

const BUILDINFO_EXEC_CMD =
  'for f in $(find /pkg -iname "*BuildInfo*" -type f 2>/dev/null); do echo "===FILE:$f==="; cat "$f"; done';

async function kubectlExec(kubeconfig, namespace, podName) {
  const bin = kubectlBin();
  const { stdout } = await execFileAsync(
    bin,
    [
      '--kubeconfig',
      kubeconfig,
      '--insecure-skip-tls-verify',
      'exec',
      '-n',
      namespace,
      podName,
      '--request-timeout=45s',
      '--',
      'sh',
      '-c',
      BUILDINFO_EXEC_CMD,
    ],
    { maxBuffer: 2 * 1024 * 1024, timeout: 90_000 }
  );
  return stdout;
}

async function fetchBuildInfoRhocp(kubeconfig, namespace, podName) {
  const output = await kubectlExec(kubeconfig, namespace, podName);
  const files = parseBuildInfoOutput(output);
  if (!files.length) {
    const err = new Error('No BuildInfo file found under /pkg');
    err.status = 404;
    throw err;
  }
  return {
    pod: podName,
    ...summarizeBuildInfo(files),
  };
}

async function fetchBuildInfoWr(device, creds, namespace, podName) {
  const inner = BUILDINFO_EXEC_CMD.replace(/'/g, "'\\''");
  const script = [
    'source /etc/platform/openrc',
    'for kc in "$KUBECONFIG" /etc/kubernetes/admin.conf /root/.kube/config "$HOME/.kube/config"; do',
    '  if [ -n "$kc" ] && [ -f "$kc" ]; then export KUBECONFIG="$kc"; break; fi',
    'done',
    `kubectl exec -n ${namespace} ${podName} --request-timeout=45s -- sh -c '${inner}'`,
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
  const files = parseBuildInfoOutput(output);
  if (!files.length) {
    const err = new Error('No BuildInfo file found under /pkg');
    err.status = 404;
    throw err;
  }
  return {
    pod: podName,
    ...summarizeBuildInfo(files),
  };
}

async function attachBuildInfo(result, fetchCtx) {
  const dmpPod = pickDmpPod(result.pods);
  if (!dmpPod) {
    result.software_version = null;
    result.build_info = { error: 'No running dmp pod found' };
    return result;
  }

  try {
    let info;
    if (fetchCtx.platform === 'Wind River') {
      info = await fetchBuildInfoWr(
        fetchCtx.device,
        fetchCtx.creds,
        result.cluster_namespace,
        dmpPod.name
      );
    } else {
      info = await fetchBuildInfoRhocp(
        fetchCtx.kubeconfig,
        result.cluster_namespace,
        dmpPod.name
      );
    }
    result.software_version = info.version;
    result.build_info = {
      pod: info.pod,
      version: info.version,
      fields: info.fields,
      files: info.files,
    };
  } catch (err) {
    result.software_version = null;
    result.build_info = {
      pod: dmpPod.name,
      error: err.message || 'BuildInfo fetch failed',
    };
  }
  return result;
}

module.exports = {
  pickDmpPod,
  parseBuildInfoOutput,
  parseBuildInfoFields,
  summarizeBuildInfo,
  fetchBuildInfoRhocp,
  fetchBuildInfoWr,
  attachBuildInfo,
};
