const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractErrorSignatures,
} = require('../src/services/network-samsung-issue-log');

test('extractErrorSignatures prefers Helm re-use release names', () => {
  const text =
    'Error: INSTALLATION FAILED: failed post-install: cannot re-use a name that is still in use: samsunguadpf-29991573161';
  const sigs = extractErrorSignatures(text);
  assert.ok(sigs.some((s) => /cannot re-use a name/i.test(s)));
  assert.ok(sigs.some((s) => /samsunguadpf-29991573161/i.test(s)));
});

test('extractErrorSignatures ignores empty fatal wrapper noise when better signal exists', () => {
  const text = [
    'fatal: ["msg": ""]',
    'Error: INSTALLATION FAILED: helm install failed in namespace ss-vdu-001',
  ].join('\n');
  const sigs = extractErrorSignatures(text);
  assert.ok(sigs.some((s) => /INSTALLATION FAILED/i.test(s)));
});
