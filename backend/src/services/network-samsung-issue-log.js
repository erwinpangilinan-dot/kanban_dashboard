const db = require('../db');

const ISSUE_NAME_BY_OPERATION = {
  precheck: 'Samsung Precheck Failed',
  deployment: 'Samsung Deployment Failed',
  upgrade: 'Samsung Upgrade Failed',
  rollback: 'Samsung Rollback Failed',
  undeployment: 'Samsung Undeployment Failed',
};

const OPERATIONS = new Set(Object.keys(ISSUE_NAME_BY_OPERATION));

function normalizeOperation(operation) {
  const op = String(operation || '').trim().toLowerCase();
  return OPERATIONS.has(op) ? op : null;
}

function issueNameForOperation(operation) {
  const op = normalizeOperation(operation);
  return op ? ISSUE_NAME_BY_OPERATION[op] : 'Samsung Action Failed';
}

function atlasJobIdString(monitorJobId, launcherJobId) {
  const monitor = monitorJobId != null && monitorJobId !== '' ? String(monitorJobId) : null;
  if (monitor) return monitor;
  const launcher = launcherJobId != null && launcherJobId !== '' ? String(launcherJobId) : null;
  return launcher;
}

function buildDedupeKey({ atlasJobId, deviceId, operation, launchedAt, fallbackKey }) {
  if (atlasJobId) return `job:${atlasJobId}`;
  if (launchedAt && deviceId && operation) {
    return `launch:${deviceId}:${operation}:${launchedAt}`;
  }
  if (fallbackKey) return `error:${fallbackKey}`;
  return `error:${deviceId || 'unknown'}:${operation || 'unknown'}:${Date.now()}`;
}

/**
 * One open issue per gNB DUID + operation. Retries with the same failure
 * (even if Atlas wording/job id differs) must not create another Issues row.
 */
async function findOpenIssueForClusterOperation(clusterId, operation) {
  const { rows } = await db.query(
    `SELECT *
     FROM network_samsung_issue_log
     WHERE cluster_id = $1
       AND operation = $2
       AND resolved_date IS NULL
     ORDER BY issue_date DESC
     LIMIT 1`,
    [String(clusterId), operation]
  );
  return rows[0] ? mapIssueRow(rows[0]) : null;
}

function mapIssueRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    device_id: row.device_id,
    issue_name: row.issue_name,
    cluster_id: row.cluster_id,
    site_type: row.site_type,
    issue_description: row.issue_description || '',
    atlas_job_id: row.atlas_job_id,
    atlas_job_name: row.atlas_job_name || null,
    issue_date: row.issue_date,
    resolved_date: row.resolved_date,
    resolution_details: row.resolution_details,
    user_reporter: row.user_reporter,
    operation: row.operation,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Insert a failure row. Idempotent on dedupe_key (ON CONFLICT DO NOTHING).
 * Returns the inserted row, or null if a duplicate was skipped.
 */
async function recordSamsungIssueFailure({
  deviceId = null,
  clusterId,
  siteType = null,
  operation,
  issueDescription = '',
  atlasJobId = null,
  atlasJobName = null,
  launcherJobId = null,
  monitorJobId = null,
  launchedAt = null,
  userReporter = 'system',
  issueDate = null,
  fallbackKey = null,
} = {}) {
  const op = normalizeOperation(operation);
  if (!op) {
    const err = new Error(`Invalid Samsung operation: ${operation}`);
    err.status = 400;
    throw err;
  }
  if (!clusterId) {
    const err = new Error('cluster_id is required to record a Samsung issue');
    err.status = 400;
    throw err;
  }

  const resolvedAtlasJobId =
    atlasJobId != null && atlasJobId !== ''
      ? String(atlasJobId)
      : atlasJobIdString(monitorJobId, launcherJobId);

  const description =
    String(issueDescription || '').trim() || 'Samsung action failed';
  const jobName =
    atlasJobName != null && String(atlasJobName).trim()
      ? String(atlasJobName).trim()
      : null;

  const existingOpen = await findOpenIssueForClusterOperation(clusterId, op);
  if (existingOpen) {
    // Keep the open row; refresh latest Atlas job id / playbook name when they change.
    const jobIdChanged =
      resolvedAtlasJobId &&
      resolvedAtlasJobId !== String(existingOpen.atlas_job_id || '');
    const jobNameChanged =
      jobName && jobName !== String(existingOpen.atlas_job_name || '');
    const descriptionChanged =
      description && description !== String(existingOpen.issue_description || '');
    if (jobIdChanged || jobNameChanged || descriptionChanged) {
      const { rows: updated } = await db.query(
        `UPDATE network_samsung_issue_log
         SET atlas_job_id = COALESCE($1, atlas_job_id),
             atlas_job_name = COALESCE(NULLIF($2, ''), atlas_job_name),
             issue_description = COALESCE(NULLIF($3, ''), issue_description),
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [resolvedAtlasJobId, jobName, description, existingOpen.id]
      );
      return mapIssueRow(updated[0]) || existingOpen;
    }
    return existingOpen;
  }

  const dedupeKey = buildDedupeKey({
    atlasJobId: resolvedAtlasJobId,
    deviceId,
    operation: op,
    launchedAt,
    fallbackKey,
  });

  const { rows } = await db.query(
    `INSERT INTO network_samsung_issue_log
       (device_id, issue_name, cluster_id, site_type, issue_description,
        atlas_job_id, atlas_job_name, issue_date, user_reporter, operation, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9, $10, $11)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [
      deviceId || null,
      issueNameForOperation(op),
      String(clusterId),
      siteType || null,
      description,
      resolvedAtlasJobId,
      jobName,
      issueDate || null,
      String(userReporter || 'system').trim() || 'system',
      op,
      dedupeKey,
    ]
  );
  return mapIssueRow(rows[0]) || null;
}

async function listSamsungIssues({
  clusterId = null,
  operation = null,
  openOnly = false,
  search = null,
  limit = 200,
  offset = 0,
} = {}) {
  const clauses = [];
  const params = [];
  let i = 1;

  if (clusterId) {
    clauses.push(`cluster_id = $${i++}`);
    params.push(String(clusterId));
  }
  if (operation) {
    const op = normalizeOperation(operation);
    if (!op) {
      const err = new Error(`Invalid operation filter: ${operation}`);
      err.status = 400;
      throw err;
    }
    clauses.push(`operation = $${i++}`);
    params.push(op);
  }
  if (openOnly) {
    clauses.push('resolved_date IS NULL');
  }
  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    clauses.push(
      `(cluster_id ILIKE $${i} OR issue_description ILIKE $${i} OR issue_name ILIKE $${i} OR COALESCE(atlas_job_id, '') ILIKE $${i} OR COALESCE(atlas_job_name, '') ILIKE $${i})`
    );
    params.push(q);
    i += 1;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM network_samsung_issue_log ${where}`,
    params
  );

  const { rows } = await db.query(
    `SELECT * FROM network_samsung_issue_log
     ${where}
     ORDER BY issue_date DESC, created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, lim, off]
  );

  return {
    issues: rows.map(mapIssueRow),
    total: countResult.rows[0]?.total ?? 0,
    limit: lim,
    offset: off,
  };
}

/**
 * Distinctive fragments from Atlas/Helm failure text for Issues cross-ref.
 */
function extractErrorSignatures(text) {
  const t = String(text || '');
  const out = [];
  const push = (s) => {
    const cleaned = String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 12 && cleaned.length <= 160) out.push(cleaned);
  };

  const reuse = t.match(/cannot re-use a name that is still in use:\s*\S+/i);
  if (reuse) push(reuse[0]);

  const release = t.match(/samsunguadpf-\d{5,}/i);
  if (release) push(release[0]);

  const helm = t.match(/Error:\s*INSTALLATION FAILED:[^\n]{0,100}/i);
  if (helm) push(helm[0]);

  const api = t.match(/\b[45]\d{2} Client Error:[^\n]{0,80}/i);
  if (api) push(api[0]);

  const perm = t.match(/PermissionError:[^\n]{0,80}/i);
  if (perm) push(perm[0]);

  if (out.length === 0) {
    const line = t
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length >= 24 && l.length <= 140 && !/^fatal:/i.test(l));
    if (line) push(line);
  }

  return [...new Set(out)];
}

function escapeIlike(value) {
  return String(value).replace(/([%_\\])/g, '\\$1');
}

/**
 * Ranked prior Issues-tab resolutions for few-shot / fallback reuse.
 * Prefers same gNB DUID + operation, then signature matches across sites.
 */
async function findPriorIssueResolutions({
  clusterId,
  operation,
  detail,
  stdoutExcerpt,
  limit = 5,
} = {}) {
  const op = normalizeOperation(operation);
  const haystack = `${detail || ''}\n${stdoutExcerpt || ''}`;
  const signatures = extractErrorSignatures(haystack);
  const cid = clusterId != null && clusterId !== '' ? String(clusterId) : null;
  const max = Math.max(1, Math.min(Number(limit) || 5, 10));

  const candidates = [];
  if (cid && op) {
    const { rows } = await db.query(
      `SELECT *
       FROM network_samsung_issue_log
       WHERE cluster_id = $1
         AND operation = $2
         AND resolution_details IS NOT NULL
         AND TRIM(resolution_details) <> ''
       ORDER BY
         CASE WHEN resolved_date IS NOT NULL THEN 0 ELSE 1 END,
         issue_date DESC
       LIMIT 8`,
      [cid, op]
    );
    candidates.push(...rows);
  }

  if (signatures.length > 0) {
    const sigs = signatures.slice(0, 5);
    const params = [];
    let i = 1;
    const likes = sigs.map((s) => {
      params.push(`%${escapeIlike(s)}%`);
      const idx = i++;
      return `(issue_description ILIKE $${idx} ESCAPE '\\' OR resolution_details ILIKE $${idx} ESCAPE '\\')`;
    });
    let sql = `SELECT *
       FROM network_samsung_issue_log
       WHERE resolution_details IS NOT NULL
         AND TRIM(resolution_details) <> ''
         AND (${likes.join(' OR ')})`;
    if (op) {
      sql += ` AND operation = $${i++}`;
      params.push(op);
    }
    if (cid) {
      sql += ` AND cluster_id <> $${i++}`;
      params.push(cid);
    }
    sql += ` ORDER BY
         CASE WHEN resolved_date IS NOT NULL THEN 0 ELSE 1 END,
         issue_date DESC
       LIMIT 20`;
    const { rows } = await db.query(sql, params);
    candidates.push(...rows);
  }

  if (candidates.length === 0) return [];

  const seen = new Set();
  const scored = [];
  for (const row of candidates) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const desc = String(row.issue_description || '');
    const res = String(row.resolution_details || '');
    let score = 0;
    if (cid && String(row.cluster_id) === cid) score += 100;
    if (op && row.operation === op) score += 40;
    if (row.resolved_date) score += 15;
    for (const sig of signatures) {
      const needle = sig.toLowerCase();
      if (desc.toLowerCase().includes(needle) || res.toLowerCase().includes(needle)) {
        score += 35;
      }
    }
    const minScore = cid && String(row.cluster_id) === cid ? 100 : 70;
    if (score >= minScore) {
      scored.push({ issue: mapIssueRow(row), score, signatures });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

/**
 * Find a prior Issues-tab entry with a recorded solution for this failure.
 * Prefers same gNB DUID + operation, then signature matches across sites.
 */
async function findPriorIssueResolution(opts = {}) {
  const ranked = await findPriorIssueResolutions({ ...opts, limit: 1 });
  return ranked[0]?.issue || null;
}

async function updateSamsungIssueResolution(id, { resolvedDate, resolutionDetails } = {}) {
  if (!id) {
    const err = new Error('Issue id is required');
    err.status = 400;
    throw err;
  }

  const before = await db.query(`SELECT * FROM network_samsung_issue_log WHERE id = $1`, [id]);
  const previous = before.rows[0] ? mapIssueRow(before.rows[0]) : null;

  const sets = ['updated_at = NOW()'];
  const params = [];
  let i = 1;

  if (resolvedDate !== undefined) {
    if (resolvedDate === null || resolvedDate === '') {
      sets.push('resolved_date = NULL');
    } else {
      const d = new Date(resolvedDate);
      if (Number.isNaN(d.getTime())) {
        const err = new Error('resolved_date must be a valid date');
        err.status = 400;
        throw err;
      }
      sets.push(`resolved_date = $${i++}`);
      params.push(d.toISOString());
    }
  }

  if (resolutionDetails !== undefined) {
    sets.push(`resolution_details = $${i++}`);
    params.push(resolutionDetails == null ? null : String(resolutionDetails));
  }

  if (params.length === 0 && !sets.some((s) => s.startsWith('resolved_date'))) {
    const err = new Error('Provide resolved_date and/or resolution_details');
    err.status = 400;
    throw err;
  }

  params.push(id);
  const { rows } = await db.query(
    `UPDATE network_samsung_issue_log
     SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING *`,
    params
  );
  if (!rows[0]) {
    const err = new Error('Issue not found');
    err.status = 404;
    throw err;
  }
  const updated = mapIssueRow(rows[0]);

  // Capture operator correction for few-shot learning when remediation text changes.
  if (
    resolutionDetails !== undefined &&
    updated.resolution_details &&
    String(updated.resolution_details).trim() &&
    String(updated.resolution_details).trim() !== String(previous?.resolution_details || '').trim()
  ) {
    try {
      const {
        recordOperatorFailureCorrection,
      } = require('./network-samsung-failure-analysis');
      await recordOperatorFailureCorrection({
        issue: updated,
        previousRemediation: previous?.resolution_details || null,
      });
    } catch (err) {
      console.warn('[samsung-issue-log] failure-learning correction skipped:', err.message);
    }
  }

  return updated;
}

module.exports = {
  ISSUE_NAME_BY_OPERATION,
  issueNameForOperation,
  extractErrorSignatures,
  findPriorIssueResolution,
  findPriorIssueResolutions,
  recordSamsungIssueFailure,
  listSamsungIssues,
  updateSamsungIssueResolution,
};
