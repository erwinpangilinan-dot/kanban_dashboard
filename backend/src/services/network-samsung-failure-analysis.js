const db = require('../db');
const ollama = require('./ollama');
const { remember, recall } = require('./memoria-client');
const {
  extractErrorSignatures,
  findPriorIssueResolution,
  findPriorIssueResolutions,
} = require('./network-samsung-issue-log');

const FEW_SHOT_LIMIT = 5;
const ATLAS_FAILURE_MEMORY_PREFIX = '[AtlasFailure]';

/**
 * Rank how useful a failure detail string is for operators.
 * Wrapper playbooks often bury the real Helm/API cause.
 */
function failureDetailScore(text) {
  if (!text) return 0;
  const t = String(text);
  let score = 0;
  if (/INSTALLATION FAILED/i.test(t)) score += 12;
  if (/helm install failed/i.test(t)) score += 10;
  if (/cannot re-use a name that is still in use/i.test(t)) score += 14;
  if (/Error occurred during API launch request/i.test(t)) score += 8;
  if (/\b[45]\d{2} Client Error\b/i.test(t)) score += 8;
  if (/PermissionError:/i.test(t)) score += 6;
  if (/fatal:/i.test(t) && /"msg"\s*:\s*""/.test(t)) score -= 6;
  if (/failed_when_result/i.test(t) && !/INSTALLATION FAILED|helm install/i.test(t)) score -= 4;
  if (t.length > 30 && t.length < 500) score += 2;
  if (t.length >= 500) score -= 1;
  return score;
}

function isMoreSpecificFailure(candidate, baseline) {
  return failureDetailScore(candidate) > failureDetailScore(baseline);
}

/** Prefer nested DirectDeploy/Helm jobs when detail quality is equal/near-equal. */
function shouldPreferNestedJob(candidateSummary, baselineSummary) {
  if (!candidateSummary?.job_id) return false;
  if (!baselineSummary?.job_id) return true;
  if (Number(candidateSummary.job_id) === Number(baselineSummary.job_id)) return false;
  const candScore = failureDetailScore(candidateSummary.job_explanation);
  const baseScore = failureDetailScore(baselineSummary.job_explanation);
  if (candScore > baseScore) return true;
  if (candScore < baseScore - 1) return false;
  const candName = String(candidateSummary.name || '');
  const baseName = String(baselineSummary.name || '');
  const nestedHint = /DirectDeploy|helm|CNF-ATLAS/i.test(candName);
  const wrapperHint = /DAY0|Wrapper|New Repo/i.test(baseName);
  if (nestedHint && wrapperHint) return true;
  // Same-quality later job ids are usually the spawned root-cause playbook.
  return candScore >= baseScore && Number(candidateSummary.job_id) > Number(baselineSummary.job_id);
}

function analysisFromPriorIssue(issue, { detail, clusterId, operation } = {}) {
  const resolution = String(issue.resolution_details || '').trim();
  if (!resolution) return null;
  const priorDesc = String(issue.issue_description || '').trim();
  const detailText = String(detail || '').trim();
  const rootCause =
    (detailText && failureDetailScore(detailText) >= failureDetailScore(priorDesc)
      ? detailText
      : priorDesc || detailText
    ).slice(0, 500) || priorDesc;
  const sameSite = clusterId && String(issue.cluster_id) === String(clusterId);
  const summary = sameSite
    ? `Known fix from Issues tab for this gNB (${issue.issue_name || operation || 'Samsung'})`
    : `Known fix from Issues tab · prior ${issue.cluster_id} (${issue.issue_name || 'Samsung'})`;

  return {
    root_cause: rootCause,
    summary,
    remediation: resolution,
    provider: 'issues',
    issue_id: issue.id,
    matched_cluster_id: issue.cluster_id,
    issue_date: issue.issue_date,
  };
}

function normalizeFewShot(entry) {
  if (!entry) return null;
  const failure = String(entry.failure || '').trim().slice(0, 400);
  const remediation = String(entry.remediation || '').trim().slice(0, 400);
  if (!failure || !remediation) return null;
  return {
    failure,
    remediation,
    source: entry.source || 'issues',
    score: Number(entry.score) || 0,
    cluster_id: entry.cluster_id || null,
    issue_id: entry.issue_id || null,
  };
}

function formatFewShotsForPrompt(fewShots) {
  if (!fewShots?.length) return '';
  return fewShots
    .map((ex, i) => {
      const src =
        ex.source === 'correction'
          ? 'operator correction'
          : ex.source === 'memoria'
            ? 'Memoria'
            : ex.source === 'issues'
              ? 'Issues tab'
              : ex.source;
      return (
        `Example ${i + 1} (${src}${ex.cluster_id ? `, gNB ${ex.cluster_id}` : ''}):\n` +
        `failure: ${ex.failure}\n` +
        `remediation: ${ex.remediation}`
      );
    })
    .join('\n\n');
}

/**
 * Durable Memoria note for an accepted Atlas failure fix.
 * Format is parsed again on recall for few-shot injection.
 */
function formatAtlasFailureMemory({
  operation,
  signatures = [],
  failure,
  remediation,
  clusterId,
  issueId,
  atlasJobId,
} = {}) {
  const op = String(operation || 'unknown').trim().toLowerCase();
  const sig = (signatures[0] || String(failure || '').slice(0, 120)).replace(/\s+/g, ' ').trim();
  const lines = [
    `${ATLAS_FAILURE_MEMORY_PREFIX} operation=${op} signature=${sig}`,
    'Entities: [[Network Equipment]], [[Samsung Atlas]]',
    '',
    `Failure: ${String(failure || '').replace(/\s+/g, ' ').trim().slice(0, 500)}`,
    `Remediation: ${String(remediation || '').replace(/\s+/g, ' ').trim().slice(0, 500)}`,
  ];
  if (clusterId) lines.push(`gNB: ${clusterId}`);
  if (issueId) lines.push(`issue_id: ${issueId}`);
  if (atlasJobId) lines.push(`atlas_job_id: ${atlasJobId}`);
  return lines.join('\n');
}

function parseAtlasFailureMemory(content) {
  const text = String(content || '');
  if (!text.includes(ATLAS_FAILURE_MEMORY_PREFIX) && !/\[AtlasFailure\]/i.test(text)) {
    return null;
  }
  const failureMatch = text.match(/Failure:\s*([^\n]+)/i);
  const remediationMatch = text.match(/Remediation:\s*([^\n]+)/i);
  const opMatch = text.match(/operation=([a-z_]+)/i);
  const gnbMatch = text.match(/gNB:\s*(\S+)/i);
  const issueMatch = text.match(/issue_id:\s*(\S+)/i);
  const failure = failureMatch?.[1]?.trim() || '';
  const remediation = remediationMatch?.[1]?.trim() || '';
  if (!failure || !remediation) return null;
  return {
    failure,
    remediation,
    operation: opMatch?.[1]?.toLowerCase() || null,
    cluster_id: gnbMatch?.[1] || null,
    issue_id: issueMatch?.[1] || null,
    source: 'memoria',
  };
}

function buildAtlasFailureRecallQuery({ operation, signatures = [], detail } = {}) {
  // Include both tagged and plain "AtlasFailure" — bracketed tokens are weak in FTS.
  const parts = ['AtlasFailure', ATLAS_FAILURE_MEMORY_PREFIX];
  if (operation) parts.push(String(operation));
  for (const s of signatures.slice(0, 3)) parts.push(String(s));
  if (!signatures.length && detail) {
    parts.push(String(detail).replace(/\s+/g, ' ').trim().slice(0, 160));
  }
  return parts.join(' ').slice(0, 400);
}

/** High-signal tokens Memoria FTS ranks better than long Helm sentences. */
function distinctiveRecallTokens(signatures = [], detail = '') {
  const text = `${signatures.join('\n')}\n${detail || ''}`;
  const tokens = [];
  const push = (s) => {
    const t = String(s || '').trim();
    if (t.length >= 6 && t.length <= 80 && !tokens.includes(t)) tokens.push(t);
  };
  for (const m of text.match(/samsunguadpf-[^\s"'\\]+/gi) || []) push(m);
  for (const m of text.match(/\b(?:fuzeProjectId|gnbDuId)=\S+/gi) || []) push(m);
  for (const m of text.match(/\b[45]\d{2} Client Error\b/gi) || []) push(m);
  for (const m of text.match(/\bcannot re-use a name that is still in use\b/gi) || []) {
    push(m);
  }
  // Last path-ish unique fragment from each signature (often the release/id).
  for (const sig of signatures) {
    const parts = String(sig).split(/[\s:/]+/).filter((p) => p.length >= 8);
    if (parts.length) push(parts[parts.length - 1]);
  }
  return tokens.slice(0, 5);
}

async function rememberAtlasFailureInMemoria({
  operation,
  signatures,
  failure,
  remediation,
  clusterId,
  issueId,
  atlasJobId,
} = {}) {
  const content = formatAtlasFailureMemory({
    operation,
    signatures,
    failure,
    remediation,
    clusterId,
    issueId,
    atlasJobId,
  });
  if (!/Failure:/i.test(content) || !/Remediation:/i.test(content)) return null;
  try {
    const { data } = await remember(content, {
      memory_type: 'semantic',
      importance: 'high',
      force: true,
      infer_entities: false,
    });
    const id = data?.id || data?.memory_id || null;
    console.info(
      `[samsung-failure-analysis] Memoria remember AtlasFailure` +
        (id ? ` id=${id}` : '') +
        (issueId ? ` issue_id=${issueId}` : '')
    );
    return id;
  } catch (err) {
    console.warn('[samsung-failure-analysis] Memoria remember skipped:', err.message);
    return null;
  }
}

/**
 * Semantic recall of prior AtlasFailure notes for rare / cross-site signatures.
 */
async function recallAtlasFailureFewShots({
  operation,
  signatures = [],
  detail,
  limit = FEW_SHOT_LIMIT,
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || FEW_SHOT_LIMIT, 10));
  const tokens = distinctiveRecallTokens(signatures, detail);
  // Distinctive tokens first — long Helm sentences + [AtlasFailure] lose to MOP chunks.
  const queries = [
    tokens.length
      ? `AtlasFailure ${tokens.join(' ')} ${operation || ''}`.trim()
      : null,
    tokens[0] ? String(tokens[0]) : null,
    buildAtlasFailureRecallQuery({ operation, signatures, detail }),
    signatures[0] ? `AtlasFailure ${signatures[0]}`.slice(0, 240) : null,
  ].filter(Boolean);

  try {
    const seenIds = new Set();
    const hits = [];
    for (const query of queries) {
      const { data } = await recall(query, 20);
      const batch = Array.isArray(data)
        ? data
        : data?.results || data?.memories || data?.items || [];
      for (const hit of batch) {
        const id = hit?.id || null;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        hits.push(hit);
      }
      if (hits.some((h) => parseAtlasFailureMemory(h?.content || h?.text || ''))) {
        break;
      }
    }

    const out = [];
    const sigNeedles = [
      ...signatures.map((s) => String(s).toLowerCase()),
      ...tokens.map((s) => String(s).toLowerCase()),
    ].filter(Boolean);
    for (const hit of hits) {
      const content = hit?.content || hit?.text || hit?.memory || '';
      const parsed = parseAtlasFailureMemory(content);
      if (!parsed) continue;
      let score = 100 + (Number(hit?.score) || 0) * 20;
      if (operation && parsed.operation === String(operation).toLowerCase()) score += 25;
      const hay = `${parsed.failure}\n${content}`.toLowerCase();
      for (const needle of sigNeedles) {
        if (needle.length >= 6 && hay.includes(needle)) score += 30;
      }
      out.push(
        normalizeFewShot({
          ...parsed,
          source: 'memoria',
          score,
        })
      );
    }
    out.sort((a, b) => (b?.score || 0) - (a?.score || 0));
    if (out.length) {
      console.info(
        `[samsung-failure-analysis] Memoria recall returned ${out.length} AtlasFailure few-shot(s)`
      );
    }
    return out.filter(Boolean).slice(0, max);
  } catch (err) {
    console.warn('[samsung-failure-analysis] Memoria recall skipped:', err.message);
    return [];
  }
}

/**
 * Prior operator corrections stored after Issues-tab resolution edits.
 */
async function findLearningFewShots({
  clusterId,
  operation,
  signatures = [],
  limit = FEW_SHOT_LIMIT,
} = {}) {
  const op = String(operation || '').trim().toLowerCase() || null;
  const cid = clusterId != null && clusterId !== '' ? String(clusterId) : null;
  const max = Math.max(1, Math.min(Number(limit) || FEW_SHOT_LIMIT, 10));
  const out = [];

  try {
    if (cid && op) {
      const { rows } = await db.query(
        `SELECT *
         FROM network_samsung_failure_learning
         WHERE cluster_id = $1
           AND operation = $2
           AND operator_remediation IS NOT NULL
           AND TRIM(operator_remediation) <> ''
         ORDER BY updated_at DESC
         LIMIT 5`,
        [cid, op]
      );
      for (const row of rows) {
        out.push({
          failure: row.failure_detail || row.ollama_root_cause || '',
          remediation: row.operator_remediation,
          source: 'correction',
          score: 150,
          cluster_id: row.cluster_id,
          issue_id: row.issue_id,
        });
      }
    }

    if (signatures.length > 0) {
      const sigs = signatures.slice(0, 5);
      const params = [op, cid];
      let i = 3;
      const likes = sigs.map((s) => {
        params.push(`%${String(s).replace(/([%_\\])/g, '\\$1')}%`);
        const idx = i++;
        return `(failure_detail ILIKE $${idx} ESCAPE '\\' OR operator_remediation ILIKE $${idx} ESCAPE '\\' OR ollama_root_cause ILIKE $${idx} ESCAPE '\\')`;
      });
      const { rows } = await db.query(
        `SELECT *
         FROM network_samsung_failure_learning
         WHERE operator_remediation IS NOT NULL
           AND TRIM(operator_remediation) <> ''
           AND ($1::text IS NULL OR operation = $1)
           AND (${likes.join(' OR ')})
         ORDER BY
           CASE WHEN cluster_id = $2 THEN 0 ELSE 1 END,
           updated_at DESC
         LIMIT 15`,
        params
      );
      for (const row of rows) {
        out.push({
          failure: row.failure_detail || row.ollama_root_cause || '',
          remediation: row.operator_remediation,
          source: 'correction',
          score: cid && String(row.cluster_id) === cid ? 140 : 110,
          cluster_id: row.cluster_id,
          issue_id: row.issue_id,
        });
      }
    }
  } catch (err) {
    // Table may not exist yet on a host that hasn't migrated.
    if (err.code !== '42P01') {
      console.warn('[samsung-failure-analysis] learning few-shots skipped:', err.message);
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const raw of out) {
    const ex = normalizeFewShot(raw);
    if (!ex) continue;
    const key = `${ex.remediation.toLowerCase()}|${ex.failure.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ex);
  }
  deduped.sort((a, b) => b.score - a.score);
  return deduped.slice(0, max);
}

/**
 * Merge Issues resolutions + operator corrections + Memoria semantic hits
 * into ranked few-shots. Corrections outrank Issues; Memoria fills rare gaps.
 */
async function collectFewShots({
  clusterId,
  operation,
  detail,
  stdoutExcerpt,
  limit = FEW_SHOT_LIMIT,
} = {}) {
  const haystack = `${detail || ''}\n${stdoutExcerpt || ''}`;
  const signatures = extractErrorSignatures(haystack);
  const max = Math.max(1, Math.min(Number(limit) || FEW_SHOT_LIMIT, 10));

  const [issueRanked, learning, memoria] = await Promise.all([
    findPriorIssueResolutions({
      clusterId,
      operation,
      detail,
      stdoutExcerpt,
      limit: max,
    }).catch((err) => {
      console.warn('[samsung-failure-analysis] Issues few-shots skipped:', err.message);
      return [];
    }),
    findLearningFewShots({
      clusterId,
      operation,
      signatures,
      limit: max,
    }),
    recallAtlasFailureFewShots({
      operation,
      signatures,
      detail,
      limit: max,
    }),
  ]);

  const fromIssues = issueRanked.map(({ issue, score }) =>
    normalizeFewShot({
      failure: issue.issue_description || detail || '',
      remediation: issue.resolution_details,
      source: 'issues',
      score: score + 0,
      cluster_id: issue.cluster_id,
      issue_id: issue.id,
    })
  );

  const merged = [...learning, ...fromIssues, ...memoria].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const ex of merged.sort((a, b) => b.score - a.score)) {
    const key = `${ex.remediation.toLowerCase()}|${ex.failure.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ex);
    if (out.length >= max) break;
  }
  return { fewShots: out, signatures };
}

async function persistOllamaAnalysis({
  clusterId,
  operation,
  jobId,
  jobName,
  detail,
  signatures,
  analysis,
} = {}) {
  if (!analysis || analysis.provider !== 'ollama') return null;
  const op = String(operation || '').trim().toLowerCase();
  if (!op) return null;
  try {
    const { rows } = await db.query(
      `INSERT INTO network_samsung_failure_learning
         (cluster_id, operation, atlas_job_id, job_name, signatures, failure_detail,
          ollama_root_cause, ollama_summary, ollama_remediation, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'ollama')
       RETURNING id`,
      [
        clusterId != null && clusterId !== '' ? String(clusterId) : null,
        op,
        jobId != null && jobId !== '' ? String(jobId) : null,
        jobName || null,
        JSON.stringify(signatures || []),
        String(detail || '').slice(0, 2000) || null,
        analysis.root_cause || null,
        analysis.summary || null,
        analysis.remediation || null,
      ]
    );
    return rows[0]?.id || null;
  } catch (err) {
    if (err.code !== '42P01') {
      console.warn('[samsung-failure-analysis] persist analysis skipped:', err.message);
    }
    return null;
  }
}

/**
 * When an operator saves Issues resolution_details, store it as a correction
 * few-shot for the next similar Atlas failure.
 */
async function recordOperatorFailureCorrection({ issue, previousRemediation } = {}) {
  if (!issue?.id) return null;
  const remediation = String(issue.resolution_details || '').trim();
  if (!remediation) return null;
  if (
    previousRemediation != null &&
    String(previousRemediation).trim() === remediation
  ) {
    return null;
  }

  const failure = String(issue.issue_description || '').trim();
  const signatures = extractErrorSignatures(failure);
  const op = String(issue.operation || '').trim().toLowerCase();
  if (!op) return null;

  let learningId = null;
  try {
    // Prefer updating an existing Ollama row for this Atlas job / issue.
    if (issue.atlas_job_id) {
      const updated = await db.query(
        `UPDATE network_samsung_failure_learning
         SET operator_remediation = $1,
             issue_id = $2,
             source = 'correction',
             updated_at = NOW()
         WHERE atlas_job_id = $3
           AND operation = $4
         RETURNING id`,
        [remediation, issue.id, String(issue.atlas_job_id), op]
      );
      if (updated.rows[0]) learningId = updated.rows[0].id;
    }

    if (!learningId) {
      const byIssue = await db.query(
        `UPDATE network_samsung_failure_learning
         SET operator_remediation = $1,
             source = 'correction',
             updated_at = NOW()
         WHERE issue_id = $2
         RETURNING id`,
        [remediation, issue.id]
      );
      if (byIssue.rows[0]) learningId = byIssue.rows[0].id;
    }

    if (!learningId) {
      const { rows } = await db.query(
        `INSERT INTO network_samsung_failure_learning
           (cluster_id, operation, atlas_job_id, job_name, signatures, failure_detail,
            operator_remediation, issue_id, source)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'correction')
         RETURNING id`,
        [
          issue.cluster_id || null,
          op,
          issue.atlas_job_id || null,
          issue.atlas_job_name || null,
          JSON.stringify(signatures),
          failure.slice(0, 2000) || null,
          remediation,
          issue.id,
        ]
      );
      learningId = rows[0]?.id || null;
      console.info(
        `[samsung-failure-analysis] Stored operator correction issue_id=${issue.id} learning_id=${learningId}`
      );
    }
  } catch (err) {
    if (err.code !== '42P01') {
      console.warn('[samsung-failure-analysis] record correction skipped:', err.message);
    }
  }

  // Always try Memoria so rare signatures survive beyond local DB.
  await rememberAtlasFailureInMemoria({
    operation: op,
    signatures,
    failure,
    remediation,
    clusterId: issue.cluster_id,
    issueId: issue.id,
    atlasJobId: issue.atlas_job_id,
  });

  return learningId;
}

/**
 * Analyze an Atlas failure with local Ollama, using prior Issues + operator
 * corrections as few-shots so accuracy improves over time (no model RL).
 * Falls back to Issues-only reuse when Ollama is unavailable.
 */
async function analyzeAtlasFailureWithOllama({
  clusterId,
  operation,
  jobId,
  jobName,
  detail,
  stdoutExcerpt,
} = {}) {
  const detailText = String(detail || '').trim();
  const excerpt = String(stdoutExcerpt || '').trim().slice(-4500);
  if (!detailText && !excerpt) return null;

  let fewShots = [];
  let signatures = extractErrorSignatures(`${detailText}\n${excerpt}`);
  try {
    const collected = await collectFewShots({
      clusterId,
      operation,
      detail: detailText,
      stdoutExcerpt: excerpt,
      limit: FEW_SHOT_LIMIT,
    });
    fewShots = collected.fewShots;
    if (collected.signatures?.length) signatures = collected.signatures;
  } catch (err) {
    console.warn('[samsung-failure-analysis] few-shot collection skipped:', err.message);
  }

  if (!ollama.isConfigured()) {
    try {
      const prior = await findPriorIssueResolution({
        clusterId,
        operation,
        detail: detailText,
        stdoutExcerpt: excerpt,
      });
      const fromIssues = prior
        ? analysisFromPriorIssue(prior, { detail: detailText, clusterId, operation })
        : null;
      if (fromIssues) {
        console.info(
          `[samsung-failure-analysis] Ollama unset — reusing Issues resolution issue_id=${fromIssues.issue_id}`
        );
        return fromIssues;
      }
    } catch (err) {
      console.warn('[samsung-failure-analysis] Issues fallback skipped:', err.message);
    }
    return null;
  }

  try {
    const fewShotBlock = formatFewShotsForPrompt(fewShots);
    const parsed = await ollama.chatJson({
      messages: [
        {
          role: 'system',
          content:
            'You analyze Samsung Atlas / Ansible / Helm deployment failures for telecom vDU/UDU ops. ' +
            'Return ONLY JSON with keys: root_cause (one sentence, the real underlying failure), ' +
            'summary (short status line), remediation (one concrete next step). ' +
            'Prefer Helm/stderr/API errors over wrapper playbook fatals with empty msg. ' +
            'If a Helm release name like samsunguadpf-<gnbDuId> appears, include it in remediation. ' +
            'When prior examples are provided, ground remediation in those proven fixes when the failure matches; ' +
            'do not copy an example that clearly does not match this log. ' +
            'Do not invent facts not present in the logs or examples.',
        },
        {
          role: 'user',
          content: [
            `cluster_id: ${clusterId || 'unknown'}`,
            `operation: ${operation || 'unknown'}`,
            `job: ${jobName || 'unknown'} (#${jobId || 'n/a'})`,
            detailText ? `extracted_detail:\n${detailText}` : null,
            excerpt ? `stdout_excerpt:\n${excerpt}` : null,
            fewShotBlock
              ? `prior_resolved_examples:\n${fewShotBlock}`
              : 'prior_resolved_examples: (none yet)',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });

    const rootCause = String(parsed.root_cause || parsed.rootCause || '').trim();
    const summary = String(parsed.summary || '').trim();
    const remediation = String(parsed.remediation || '').trim();
    if (!rootCause && !summary) return null;

    const analysis = {
      root_cause: rootCause || summary,
      summary: summary || rootCause,
      remediation: remediation || null,
      provider: 'ollama',
      few_shot_count: fewShots.length,
    };

    const learningId = await persistOllamaAnalysis({
      clusterId,
      operation,
      jobId,
      jobName,
      detail: detailText,
      signatures,
      analysis,
    });
    if (learningId) analysis.learning_id = learningId;

    if (fewShots.length) {
      console.info(
        `[samsung-failure-analysis] Ollama analysis with ${fewShots.length} few-shot(s)` +
          (learningId ? ` learning_id=${learningId}` : '')
      );
    }

    return analysis;
  } catch (err) {
    console.warn('[samsung-failure-analysis] Ollama analysis skipped:', err.message);
    try {
      const prior = await findPriorIssueResolution({
        clusterId,
        operation,
        detail: detailText,
        stdoutExcerpt: excerpt,
      });
      return prior
        ? analysisFromPriorIssue(prior, { detail: detailText, clusterId, operation })
        : null;
    } catch {
      return null;
    }
  }
}

module.exports = {
  failureDetailScore,
  isMoreSpecificFailure,
  shouldPreferNestedJob,
  analyzeAtlasFailureWithOllama,
  collectFewShots,
  formatFewShotsForPrompt,
  formatAtlasFailureMemory,
  parseAtlasFailureMemory,
  buildAtlasFailureRecallQuery,
  distinctiveRecallTokens,
  rememberAtlasFailureInMemoria,
  recallAtlasFailureFewShots,
  recordOperatorFailureCorrection,
  persistOllamaAnalysis,
};
