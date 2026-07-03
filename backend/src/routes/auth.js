const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isAuthEnabled, requireAuth } = require('../middleware/auth');
const { signToken } = require('../lib/jwt');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({ enabled: isAuthEnabled() });
});

router.post('/login', asyncHandler(async (req, res) => {
  if (!isAuthEnabled()) {
    return res.json({ enabled: false });
  }

  const { username, password } = req.body;
  if (
    username !== process.env.AUTH_USERNAME ||
    password !== process.env.AUTH_PASSWORD
  ) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = signToken({ username }, process.env.JWT_SECRET);
  res.json({ enabled: true, token, username });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role || 'user' });
});

module.exports = router;
