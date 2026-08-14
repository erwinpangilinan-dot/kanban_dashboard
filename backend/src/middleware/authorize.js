const { ADMIN_VIEW } = require('../lib/permissions');

/**
 * Maps the first path segment under /api to the dashboard tab that owns it.
 *
 * A user who cannot see a tab must not be able to call its endpoints directly,
 * so this is the server-side half of the sidebar filtering. Anything not listed
 * is denied rather than allowed by default; tests/authorize.test.js walks the
 * mounted router and fails if a new route has no entry here.
 */
const VIEW_BY_SEGMENT = {
  // Overview
  overview: 'overview',
  activity: 'overview',
  ops: 'overview',

  // Kanban boards
  projects: 'board',
  tasks: 'board',
  columns: 'board',
  boards: 'board',
  labels: 'board',
  github: 'board',

  workspace: 'workspace',
  memoria: 'memoria',
  network: 'network',
  users: ADMIN_VIEW,
};

// Handled before this middleware runs, or intentionally unauthenticated.
const UNGATED_SEGMENTS = new Set(['auth', 'health', 'webhooks']);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function segmentFor(path) {
  return String(path || '').split('/').filter(Boolean)[0] || '';
}

function viewForPath(path) {
  return VIEW_BY_SEGMENT[segmentFor(path)] ?? null;
}

function authorize(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Authentication required.' });

  const segment = segmentFor(req.path);
  if (UNGATED_SEGMENTS.has(segment)) return next();

  const view = VIEW_BY_SEGMENT[segment];
  if (!view) {
    return res.status(403).json({ error: 'This endpoint is not available to your account.' });
  }

  if (view === ADMIN_VIEW) {
    if (!user.is_admin) {
      return res.status(403).json({ error: 'Administrator access is required.' });
    }
  } else if (!user.views?.includes(view)) {
    return res
      .status(403)
      .json({ error: `Your account does not have access to the ${view} section.` });
  }

  if (!READ_METHODS.has(req.method) && !user.can_write) {
    return res.status(403).json({ error: 'Your account has read-only access.' });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }
  return next();
}

/**
 * For routers mounted ahead of `authorize` (the Google OAuth flow), where the
 * path cannot be mapped to a tab by its first segment.
 */
function requireView(view) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!req.user.views?.includes(view)) {
      return res
        .status(403)
        .json({ error: `Your account does not have access to the ${view} section.` });
    }
    return next();
  };
}

function requireWrite(req, res, next) {
  if (!req.user?.can_write) {
    return res.status(403).json({ error: 'Your account has read-only access.' });
  }
  return next();
}

module.exports = {
  authorize,
  requireAdmin,
  requireView,
  requireWrite,
  viewForPath,
  VIEW_BY_SEGMENT,
  UNGATED_SEGMENTS,
  READ_METHODS,
};
