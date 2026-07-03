#!/usr/bin/env node
const assert = require('assert');
const { signToken, verifyToken } = require('../src/lib/jwt');

const secret = 'test-secret';
const token = signToken({ username: 'ci' }, secret, 60);
const payload = verifyToken(token, secret);
assert.strictEqual(payload.username, 'ci');

try {
  verifyToken(token, 'wrong-secret');
  assert.fail('expected invalid secret to throw');
} catch (err) {
  assert.strictEqual(err.status, 401);
}

console.log('✓ auth JWT verify passed');
