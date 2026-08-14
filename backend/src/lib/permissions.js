/**
 * Roles and tab (view) keys shared by the users service, the authorization
 * middleware, and the admin API. The view keys match the frontend AppView union
 * in frontend/src/types/index.ts.
 */

const ROLES = ['admin', 'editor', 'viewer'];

// Tabs an admin can grant to a user.
const ASSIGNABLE_VIEWS = ['overview', 'board', 'workspace', 'memoria', 'network'];

// The user management tab is implied by the admin role rather than granted.
const ADMIN_VIEW = 'users';

const ALL_VIEWS = [...ASSIGNABLE_VIEWS, ADMIN_VIEW];

function isValidRole(role) {
  return ROLES.includes(role);
}

function isAdmin(role) {
  return role === 'admin' || role === 'service';
}

function canWrite(role) {
  return role !== 'viewer';
}

/**
 * Admins and the API service token reach every tab regardless of what is stored,
 * so an admin cannot accidentally lock themselves out of the users tab.
 */
function effectiveViews(role, allowedViews) {
  if (isAdmin(role)) return [...ALL_VIEWS];
  return (allowedViews || []).filter((view) => ASSIGNABLE_VIEWS.includes(view));
}

function normalizeViews(input) {
  if (!Array.isArray(input)) return null;
  const unique = new Set();
  for (const view of input) {
    if (!ASSIGNABLE_VIEWS.includes(view)) return null;
    unique.add(view);
  }
  return ASSIGNABLE_VIEWS.filter((view) => unique.has(view));
}

module.exports = {
  ROLES,
  ASSIGNABLE_VIEWS,
  ADMIN_VIEW,
  ALL_VIEWS,
  isValidRole,
  isAdmin,
  canWrite,
  effectiveViews,
  normalizeViews,
};
