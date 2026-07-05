#!/usr/bin/env node
const assert = require('assert');
const {
  parseIssueUrl,
  issueUrl,
  enrichTask,
  buildIssueBody,
  verifyWebhookSignature,
  autoCreateEnabled,
  isEnabled,
} = require('../src/services/github');

assert.deepStrictEqual(parseIssueUrl('https://github.com/acme/app/issues/42'), {
  repo: 'acme/app',
  number: 42,
});
assert.strictEqual(parseIssueUrl('https://gitlab.com/a/b/issues/1'), null);
assert.strictEqual(issueUrl('acme/app', 42), 'https://github.com/acme/app/issues/42');

const task = enrichTask({
  id: '1',
  github_repo: 'acme/app',
  github_issue_number: 7,
});
assert.strictEqual(task.github_issue_url, 'https://github.com/acme/app/issues/7');

const body = buildIssueBody(
  {
    title: 'Fix bug',
    description: 'Details here',
    priority: 'high',
    assignee: 'Alex',
    due_date: '2026-08-01T00:00:00.000Z',
  },
  'Mission Control'
);
assert(body.includes('Details here'));
assert(body.includes('**Priority:** high'));

const secret = 'test-secret';
const payload = Buffer.from('{"action":"closed"}');
const sig = `sha256=${require('crypto').createHmac('sha256', secret).update(payload).digest('hex')}`;
process.env.GITHUB_WEBHOOK_SECRET = secret;
assert.strictEqual(verifyWebhookSignature(payload, sig), true);
assert.strictEqual(verifyWebhookSignature(payload, 'sha256=bad'), false);

delete process.env.GITHUB_TOKEN;
delete process.env.GITHUB_DEFAULT_REPO;
assert.strictEqual(isEnabled(), false);
assert.strictEqual(autoCreateEnabled(), false);

process.env.GITHUB_TOKEN = 'ghp_test';
process.env.GITHUB_DEFAULT_REPO = 'acme/app';
assert.strictEqual(isEnabled(), true);
assert.strictEqual(autoCreateEnabled(), true);

process.env.GITHUB_AUTO_CREATE = 'false';
assert.strictEqual(autoCreateEnabled(), false);

console.log('✓ GitHub helpers passed');
