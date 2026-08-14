const crypto = require('crypto');

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt cost. 16384 keeps a single hash around 50-100ms on the dashboard host,
// which is slow enough to make offline guessing expensive without making the
// login request feel sluggish.
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MIN_PASSWORD_LENGTH = 8;

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      String(password),
      salt,
      KEY_LENGTH,
      { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION },
      (err, key) => (err ? reject(err) : resolve(key))
    );
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  return `scrypt$${COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Always runs a full derivation, even for a malformed stored hash, so a missing
 * or corrupt record cannot be told apart from a wrong password by response time.
 */
async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  const valid = parts.length === 4 && parts[0] === 'scrypt' && Number(parts[1]) > 0;

  const salt = valid ? Buffer.from(parts[2], 'base64') : crypto.randomBytes(SALT_LENGTH);
  const expected = valid ? Buffer.from(parts[3], 'base64') : crypto.randomBytes(KEY_LENGTH);

  const key = await derive(password, salt);
  if (!valid || key.length !== expected.length) return false;
  return crypto.timingSafeEqual(key, expected);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, validatePassword, MIN_PASSWORD_LENGTH };
