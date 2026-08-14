const crypto = require('crypto');

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * A plain `===` on a token or password returns as soon as it hits a differing
 * byte, so response time reveals how much of a guess was correct. Hashing first
 * keeps the compared buffers the same length, which also avoids leaking the
 * secret's length via the early return in timingSafeEqual.
 */
function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const right = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

module.exports = { safeEqual };
