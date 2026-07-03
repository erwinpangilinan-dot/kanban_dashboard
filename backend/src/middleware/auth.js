const { verifyToken } = require('../lib/jwt');

function isAuthEnabled() {
  return Boolean(process.env.JWT_SECRET);
}

function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);

  if (process.env.AUTH_API_TOKEN && token === process.env.AUTH_API_TOKEN) {
    req.user = { username: 'api', role: 'service' };
    return next();
  }

  try {
    req.user = verifyToken(token, process.env.JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Invalid token' });
  }
}

module.exports = { isAuthEnabled, requireAuth };
