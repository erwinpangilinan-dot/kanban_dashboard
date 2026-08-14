const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { signToken, verifyToken } = require('../src/lib/jwt');

// Mirrors the state handling in routes/workspace-oauth.js. The property that
// matters: a caller who is not going through an authenticated /oauth/start
// cannot produce a value the callback will accept, even though they control
// both the query parameter and their own cookie header.
const STATE_PURPOSE = 'google-oauth';
const SECRET = 'test-secret';

function issueState(username, ttl = 600) {
  return signToken({ purpose: STATE_PURPOSE, username }, SECRET, ttl);
}

function readState(value) {
  try {
    const claims = verifyToken(value, SECRET);
    return claims.purpose === STATE_PURPOSE ? claims : null;
  } catch {
    return null;
  }
}

test('a state issued by /oauth/start is accepted and names the operator', () => {
  const claims = readState(issueState('admin'));
  assert.equal(claims.username, 'admin');
  assert.equal(claims.purpose, STATE_PURPOSE);
});

test('an attacker-chosen state is rejected even when it matches their cookie', () => {
  // The old check was `state === cookieState`, which this would have passed.
  const forged = crypto.randomBytes(24).toString('hex');
  assert.equal(readState(forged), null);
});

test('a state signed with the wrong secret is rejected', () => {
  const foreign = signToken({ purpose: STATE_PURPOSE, username: 'admin' }, 'other-secret', 600);
  assert.equal(readState(foreign), null);
});

test('a tampered payload is rejected', () => {
  const [header, , signature] = issueState('admin').split('.');
  const swapped = Buffer.from(
    JSON.stringify({ purpose: STATE_PURPOSE, username: 'attacker', exp: 9999999999 })
  ).toString('base64url');
  assert.equal(readState(`${header}.${swapped}.${signature}`), null);
});

test('an expired state is rejected', () => {
  assert.equal(readState(issueState('admin', -1)), null);
});

test('a validly signed token for another purpose is rejected', () => {
  const loginToken = signToken({ username: 'admin' }, SECRET, 600);
  assert.equal(readState(loginToken), null);
});
