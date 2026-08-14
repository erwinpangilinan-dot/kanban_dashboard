const test = require('node:test');
const assert = require('node:assert');

const { hashPassword, verifyPassword, validatePassword } = require('../src/lib/password');

test('a hashed password verifies against the original', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse battery', hash), true);
});

test('a wrong password does not verify', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse batteri', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('the same password hashes differently each time', async () => {
  const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('same', first), true);
  assert.equal(await verifyPassword('same', second), true);
});

test('a missing or malformed hash fails instead of throwing', async () => {
  for (const stored of [undefined, null, '', 'not-a-hash', 'scrypt$0$$', 'bcrypt$a$b$c']) {
    assert.equal(await verifyPassword('anything', stored), false);
  }
});

test('passwords shorter than the minimum are rejected', () => {
  assert.match(validatePassword('short'), /at least 8 characters/);
  assert.equal(validatePassword('longenough'), null);
  assert.match(validatePassword(undefined), /at least 8 characters/);
});
