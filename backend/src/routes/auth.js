const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isAuthEnabled, requireAuth } = require('../middleware/auth');
const { signToken } = require('../lib/jwt');
const { loginRateLimiter } = require('../middleware/rate-limit');
const { authenticate, toRequestUser } = require('../services/users');
const db = require('../db');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({ enabled: isAuthEnabled() });
});

router.post('/login', loginRateLimiter, asyncHandler(async (req, res) => {
  if (!isAuthEnabled()) {
    return res.json({ enabled: false });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Nobody can sign in until the first admin exists, so say that outright rather
  // than returning "invalid credentials" for a setup problem.
  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count === 0) {
    return res.status(503).json({
      error: 'No dashboard users exist yet. Set AUTH_USERNAME and AUTH_PASSWORD in .env and restart the API.',
    });
  }

  const result = await authenticate(username, password);
  if (!result.ok) {
    if (result.reason === 'disabled') {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const user = toRequestUser(result.user);
  const token = signToken(
    { sub: user.id, username: user.username, tv: user.token_version },
    process.env.JWT_SECRET
  );

  res.json({
    enabled: true,
    token,
    username: user.username,
    role: user.role,
    views: user.views,
    can_write: user.can_write,
    is_admin: user.is_admin,
  });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({
    username: req.user.username,
    role: req.user.role,
    views: req.user.views,
    can_write: req.user.can_write,
    is_admin: req.user.is_admin,
  });
});

module.exports = router;
