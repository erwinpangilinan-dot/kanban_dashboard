const { verifyToken } = require('../lib/jwt');
const { safeEqual } = require('../lib/safe-equal');
const { ALL_VIEWS } = require('../lib/permissions');
const { findById, toRequestUser } = require('../services/users');

function isAuthEnabled() {
  return Boolean(process.env.JWT_SECRET);
}

/**
 * Auth stays optional for local dev and CI, but a production deploy that
 * silently serves the whole API unauthenticated is a worse outcome than one
 * that refuses to boot. Opting out has to be deliberate.
 */
function assertAuthConfigured() {
  if (process.env.NODE_ENV !== 'production' || isAuthEnabled()) return;

  if (process.env.ALLOW_UNAUTHENTICATED === '1') {
    console.warn(
      'WARNING: NODE_ENV=production with no JWT_SECRET. Every /api route is public because ALLOW_UNAUTHENTICATED=1 is set.'
    );
    return;
  }

  throw new Error(
    'JWT_SECRET is required when NODE_ENV=production, otherwise every /api route (tasks, ' +
      'network reboots, stored credentials, email) is served without authentication. Set ' +
      'JWT_SECRET, or set ALLOW_UNAUTHENTICATED=1 to accept an open API.'
  );
}

// With auth off there is nobody to look up, so every request runs as a local
// superuser. This only happens when JWT_SECRET is unset, which the production
// guard above forbids.
const ANONYMOUS_USER = {
  id: null,
  username: 'local',
  role: 'service',
  views: [...ALL_VIEWS],
  can_write: true,
  is_admin: true,
};

// The static API token is how MCP servers and scripts call the API. It is not a
// dashboard account, so it bypasses the users table with full access.
const SERVICE_USER = {
  id: null,
  username: 'api',
  role: 'service',
  views: [...ALL_VIEWS],
  can_write: true,
  is_admin: true,
};

/**
 * Authenticate the caller and attach the identity the authorization middleware
 * reads from.
 *
 * The JWT only identifies the account; role and tab grants come from the users
 * row on every request. That costs one indexed lookup but means an admin
 * revoking a tab or disabling an account takes effect immediately rather than
 * whenever the token happens to expire.
 */
async function requireAuth(req, res, next) {
  if (!isAuthEnabled()) {
    req.user = ANONYMOUS_USER;
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = header.slice(7);

  if (process.env.AUTH_API_TOKEN && safeEqual(token, process.env.AUTH_API_TOKEN)) {
    req.user = SERVICE_USER;
    return next();
  }

  let payload;
  try {
    payload = verifyToken(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Invalid token' });
  }

  // Required so a token minted before multi-user support, which carries only a
  // username, cannot be replayed as an account it no longer maps to.
  if (!payload.sub) {
    return res.status(401).json({ error: 'Session is out of date. Please sign in again.' });
  }

  try {
    const row = await findById(payload.sub);
    if (!row || !row.is_active) {
      return res.status(401).json({ error: 'Account is no longer active.' });
    }
    if (Number(payload.tv ?? 0) !== Number(row.token_version)) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    req.user = toRequestUser(row);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { isAuthEnabled, requireAuth, assertAuthConfigured, ANONYMOUS_USER, SERVICE_USER };
