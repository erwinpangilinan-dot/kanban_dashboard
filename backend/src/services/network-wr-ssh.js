const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execFileAsync = promisify(execFile);

function normalizeSshHost(host) {
  const trimmed = String(host || '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function sshTarget(host, user) {
  const trimmed = String(host || '').trim();
  const bracketed =
    trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed;
  return `${user}@${bracketed}`;
}

function sshCommonOpts() {
  const knownHosts = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    `UserKnownHostsFile=${knownHosts}`,
    '-o',
    'ConnectTimeout=30',
    '-o',
    'LogLevel=ERROR',
  ];
}

async function commandExists(name) {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    await execFileAsync(checker, [name]);
    return true;
  } catch {
    return false;
  }
}

async function execSshRemote(host, user, password, keyPath, remoteCommand) {
  const target = sshTarget(host, user);
  const opts = sshCommonOpts();

  if (keyPath && fs.existsSync(keyPath)) {
    const { stdout, stderr } = await execFileAsync(
      process.env.SSH_PATH || 'ssh',
      ['-i', keyPath, '-o', 'BatchMode=yes', ...opts, target, remoteCommand],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }
    );
    return stdout + (stderr ? `\n${stderr}` : '');
  }

  if (password && (await commandExists('sshpass'))) {
    const { stdout, stderr } = await execFileAsync(
      'sshpass',
      ['-p', password, 'ssh', ...opts, target, remoteCommand],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }
    );
    return stdout + (stderr ? `\n${stderr}` : '');
  }

  if (password && process.platform === 'win32' && (await commandExists('plink'))) {
    const { stdout, stderr } = await execFileAsync(
      'plink',
      ['-batch', '-pw', password, target, remoteCommand],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }
    );
    return stdout + (stderr ? `\n${stderr}` : '');
  }

  if (password && (await commandExists('sshpass'))) {
    const { stdout, stderr } = await execFileAsync(
      'sshpass',
      ['-p', password, 'ssh', ...sshCommonOpts(), target, remoteCommand],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }
    );
    return stdout + (stderr ? `\n${stderr}` : '');
  }

  if (password) {
    const err = new Error(
      'Password WR SSH needs sshpass (Linux) or plink (Windows). Install sshpass in the API image, or use a key via NETWORK_WR_SSH_KEY_PATH.'
    );
    err.status = 400;
    throw err;
  }

  const err = new Error(
    'WR SSH not configured: set NETWORK_WR_SSH_KEY_PATH, or save WR SSH username/password in Network → Settings'
  );
  err.status = 400;
  throw err;
}

function extractSection(output, name) {
  const marker = `___SECTION:${name}___`;
  const start = output.indexOf(marker);
  if (start < 0) return '';
  const from = start + marker.length;
  const next = output.indexOf('___SECTION:', from);
  return (next >= 0 ? output.slice(from, next) : output.slice(from)).trim();
}

function parseHostList(output) {
  const text = extractSection(output, 'host-list') || output;
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('+') && !l.startsWith('| id'));
  let total = 0;
  let available = 0;
  const names = [];
  for (const line of lines) {
    if (!line.includes('|')) continue;
    total += 1;
    const cols = line.split('|').map((c) => c.trim());
    const name = cols[2] || cols[1] || '';
    if (name) names.push(name);
    const row = line.toLowerCase();
    if (row.includes('available') || row.includes(' enabled ')) available += 1;
  }
  return { total, available, names, raw: text.slice(0, 400) };
}

function parseAlarms(output) {
  const text = extractSection(output, 'alarms') || output;
  const lower = text.toLowerCase();
  const critical = (lower.match(/\bcritical\b/g) || []).length;
  const major = (lower.match(/\bmajor\b/g) || []).length;
  const hasRows = text.split('\n').some((l) => l.includes('|') && !l.startsWith('+'));
  return { critical, major, hasRows, raw: text.slice(0, 400) };
}

function parseWrcpVersion(release) {
  const m = String(release || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareWrcpRelease(a, b) {
  const va = parseWrcpVersion(a);
  const vb = parseWrcpVersion(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (va[i] !== vb[i]) return va[i] - vb[i];
  }
  return 0;
}

function pickPrimarySoftwareRow(rows) {
  if (!rows.length) return null;
  const deployed = rows.filter((r) => /deployed/i.test(r.state));
  const pool = deployed.length ? deployed : rows;
  return pool.reduce((best, row) => {
    if (!best) return row;
    return compareWrcpRelease(row.release, best.release) > 0 ? row : best;
  }, null);
}

function parseSoftwareList(output) {
  const text = extractSection(output, 'software') || output;
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.includes('|') || line.startsWith('+')) continue;
    const cols = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!cols.length || /^release$/i.test(cols[0])) continue;
    rows.push({
      release: cols[0] || '',
      rr: cols[1] || '',
      state: cols[2] || '',
    });
  }
  const primary = pickPrimarySoftwareRow(rows);
  const deployedReleases = [
    ...new Set(rows.filter((r) => /deployed/i.test(r.state)).map((r) => r.release)),
  ];
  let detail = primary
    ? [primary.release, primary.state && primary.state !== '—' ? primary.state : null]
        .filter(Boolean)
        .join(' · ')
    : '';
  if (deployedReleases.length > 1 && primary) {
    detail += ` (latest of ${deployedReleases.join(', ')})`;
  }
  return { rows, primary, detail, deployedReleases, raw: text.slice(0, 400) };
}

function kubectlLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter((l) => {
      if (!l) return false;
      if (/^E\d{4}\s/.test(l)) return false;
      if (/^W\d{4}\s/.test(l)) return false;
      if (/^couldn't get current/i.test(l)) return false;
      if (/^The connection to the server/i.test(l)) return false;
      if (/^error:/i.test(l)) return false;
      if (/^Unable to connect/i.test(l)) return false;
      return true;
    });
}

function parseKubectlNodes(output) {
  const text = extractSection(output, 'k8s-nodes') || output;
  const lines = kubectlLines(text).filter((l) => !/^name\s+/i.test(l));
  let total = 0;
  let ready = 0;
  for (const line of lines) {
    if (/\bNotReady\b/.test(line)) {
      total += 1;
    } else if (/\bReady\b/.test(line)) {
      total += 1;
      ready += 1;
    }
  }
  return { total, ready, raw: kubectlLines(text).join('\n').slice(0, 400) };
}

function parseVduNamespaces(output, clusterId) {
  const text = extractSection(output, 'k8s-ns') || output;
  const clusterToken = String(clusterId || '').trim();
  const vduNs = kubectlLines(text)
    .map((l) => l.split(/\s+/)[0])
    .filter((name) => {
      if (!name || /^name$/i.test(name)) return false;
      if (/vdu/i.test(name)) return true;
      return clusterToken && name.includes(clusterToken);
    });
  return { vduNs, raw: kubectlLines(text).join('\n').slice(0, 400) };
}

const WR_PRECHECK_BASE = [
  'source /etc/platform/openrc',
  'for kc in "$KUBECONFIG" /etc/kubernetes/admin.conf /root/.kube/config "$HOME/.kube/config"; do',
  '  if [ -n "$kc" ] && [ -f "$kc" ]; then export KUBECONFIG="$kc"; break; fi',
  'done',
  'echo ___SECTION:host-list___',
  'system host-list 2>&1 || true',
  'echo ___SECTION:alarms___',
  'fm alarm-list 2>&1 || true',
  'echo ___SECTION:software___',
  'software list 2>&1 || true',
  'echo ___SECTION:applications___',
  'system application-list 2>&1 || true',
  'echo ___SECTION:k8s-nodes___',
  'kubectl get nodes -o wide --request-timeout=45s 2>&1 || true',
  'echo ___SECTION:k8s-ns___',
  'kubectl get ns --request-timeout=45s 2>&1 || true',
];

function buildWrPrecheckScript(customCommands = []) {
  const customLines = (customCommands || []).flatMap((cmd) => [
    `echo ___SECTION:custom-${cmd.id}___`,
    `${cmd.command} 2>&1 || true`,
  ]);
  return [...WR_PRECHECK_BASE, ...customLines].join('\n');
}

async function runWrRemotePrecheck(host, creds, customCommands = []) {
  const script = buildWrPrecheckScript(customCommands);
  const scriptB64 = Buffer.from(script, 'utf8').toString('base64');
  const wrapped = `bash -l -c ${JSON.stringify(`echo ${scriptB64} | base64 -d | bash -l`)}`;
  return execSshRemote(host, creds.username, creds.password, creds.keyPath, wrapped);
}

module.exports = {
  execSshRemote,
  runWrRemotePrecheck,
  buildWrPrecheckScript,
  parseHostList,
  parseAlarms,
  parseSoftwareList,
  parseKubectlNodes,
  parseVduNamespaces,
  extractSection,
};
