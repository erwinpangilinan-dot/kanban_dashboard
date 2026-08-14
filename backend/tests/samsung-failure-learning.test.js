const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatFewShotsForPrompt,
  failureDetailScore,
  formatAtlasFailureMemory,
  parseAtlasFailureMemory,
  buildAtlasFailureRecallQuery,
} = require('../src/services/network-samsung-failure-analysis');

test('formatFewShotsForPrompt includes operator corrections ahead of plain text', () => {
  const block = formatFewShotsForPrompt([
    {
      failure: 'cannot re-use a name that is still in use: samsunguadpf-29991573161',
      remediation: 'Undeploy leftover Helm release samsunguadpf-29991573161 then redeploy',
      source: 'correction',
      cluster_id: '29991573161',
    },
    {
      failure: 'INSTALLATION FAILED: helm install failed',
      remediation: 'Check namespace and retry deploy',
      source: 'issues',
      cluster_id: '29991512805',
    },
  ]);
  assert.match(block, /Example 1 \(operator correction/);
  assert.match(block, /samsunguadpf-29991573161/);
  assert.match(block, /Example 2 \(Issues tab/);
});

test('formatFewShotsForPrompt labels Memoria examples', () => {
  const block = formatFewShotsForPrompt([
    {
      failure: '404 Client Error on CNF deploy',
      remediation: 'Verify fuzeProjectId and Orchestrator method',
      source: 'memoria',
      cluster_id: '29991573162',
    },
  ]);
  assert.match(block, /Example 1 \(Memoria/);
  assert.match(block, /fuzeProjectId/);
});

test('formatFewShotsForPrompt returns empty string when no examples', () => {
  assert.equal(formatFewShotsForPrompt([]), '');
  assert.equal(formatFewShotsForPrompt(null), '');
});

test('failureDetailScore still prefers Helm re-use over empty fatals', () => {
  assert.ok(
    failureDetailScore('cannot re-use a name that is still in use: samsunguadpf-1') >
      failureDetailScore('fatal: {"msg": ""}')
  );
});

test('formatAtlasFailureMemory + parseAtlasFailureMemory round-trip', () => {
  const content = formatAtlasFailureMemory({
    operation: 'deployment',
    signatures: ['cannot re-use a name that is still in use: samsunguadpf-29991573161'],
    failure: 'cannot re-use a name that is still in use: samsunguadpf-29991573161',
    remediation: 'Undeploy leftover Helm release then redeploy',
    clusterId: '29991573161',
    issueId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    atlasJobId: '11213443',
  });
  assert.match(content, /\[AtlasFailure\] operation=deployment/);
  assert.match(content, /\[\[Network Equipment\]\]/);
  const parsed = parseAtlasFailureMemory(content);
  assert.equal(parsed.operation, 'deployment');
  assert.equal(parsed.cluster_id, '29991573161');
  assert.match(parsed.failure, /cannot re-use a name/i);
  assert.match(parsed.remediation, /Undeploy leftover Helm/i);
  assert.equal(parsed.source, 'memoria');
});

test('parseAtlasFailureMemory ignores unrelated Memoria notes', () => {
  assert.equal(parseAtlasFailureMemory('[MOP] mop_id=samsung-udu-vdu-application-deployment'), null);
});

test('buildAtlasFailureRecallQuery includes prefix and signatures', () => {
  const q = buildAtlasFailureRecallQuery({
    operation: 'upgrade',
    signatures: ['INSTALLATION FAILED', 'samsunguadpf-123'],
  });
  assert.match(q, /AtlasFailure/);
  assert.match(q, /upgrade/);
  assert.match(q, /INSTALLATION FAILED/);
});

test('distinctiveRecallTokens extracts Helm release ids', () => {
  const {
    distinctiveRecallTokens,
  } = require('../src/services/network-samsung-failure-analysis');
  const tokens = distinctiveRecallTokens(
    ['cannot re-use a name that is still in use: samsunguadpf-29991573161'],
    ''
  );
  assert.ok(tokens.some((t) => /samsunguadpf-29991573161/i.test(t)));
});
