const rateLimit = require('express-rate-limit');

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10;

/**
 * Password logins are guessable given enough requests, so the endpoint is
 * throttled per client IP. Only failed attempts count, which keeps a working
 * client from locking itself out.
 */
const loginRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_ATTEMPTS,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

module.exports = { loginRateLimiter, WINDOW_MS, MAX_ATTEMPTS };
