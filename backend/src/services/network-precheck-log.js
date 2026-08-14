const fs = require('fs');
const path = require('path');

function repoRoot() {
  return path.join(__dirname, '../../..');
}

function precheckLogRoot() {
  const configured = process.env.NETWORK_PRECHECK_LOG_DIR;
  if (configured) return path.resolve(configured);
  return path.join(repoRoot(), 'logs', 'subcloud-precheck');
}

function safeClusterDir(clusterId) {
  return String(clusterId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function formatTimestamp(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return 'unknown-time';
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function toRepoRelative(absPath) {
  const root = repoRoot();
  const rel = path.relative(root, absPath);
  return rel.split(path.sep).join('/');
}

function writePrecheckLog(device, result, extras = {}) {
  const clusterDir = path.join(precheckLogRoot(), safeClusterDir(device.cluster_id));
  fs.mkdirSync(clusterDir, { recursive: true });

  const fileName = `${formatTimestamp(result.checked_at)}.log`;
  const absPath = path.join(clusterDir, fileName);
  const lines = [
    '=== Subcloud Precheck Log ===',
    `Cluster ID: ${device.cluster_id || '—'}`,
    `Cluster name: ${device.cluster_name || '—'}`,
    `Platform: ${result.platform || device.os || '—'}`,
    `Subcloud IP: ${device.subcloud_ip || '—'}`,
    `Checked at: ${result.checked_at || new Date().toISOString()}`,
    `Status: ${result.status || 'unknown'}`,
    `Summary: ${result.summary || '—'}`,
    `Via: ${result.via || 'api'}`,
    '',
    '--- Checks ---',
  ];

  for (const c of result.checks || []) {
    lines.push(`[${c.status?.toUpperCase() || '?'}] ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  }

  if (result.error) {
    lines.push('', '--- Error ---', result.error);
  }

  if (extras.rawWrOutput) {
    lines.push('', '--- Raw WR SSH output ---', extras.rawWrOutput);
  }

  if (extras.customSections?.length) {
    lines.push('', '--- Custom commands ---');
    for (const section of extras.customSections) {
      lines.push('', `$ ${section.command}`);
      lines.push(section.output || '(no output)');
    }
  }

  fs.writeFileSync(absPath, `${lines.join('\n')}\n`, 'utf8');
  return { absPath, relativePath: toRepoRelative(absPath) };
}

module.exports = {
  precheckLogRoot,
  writePrecheckLog,
  toRepoRelative,
};
