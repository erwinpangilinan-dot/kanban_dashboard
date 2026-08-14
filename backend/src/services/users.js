const db = require('../db');
const { hashPassword, verifyPassword } = require('../lib/password');
const {
  ASSIGNABLE_VIEWS,
  canWrite,
  effectiveViews,
  isAdmin,
} = require('../lib/permissions');

const PUBLIC_COLUMNS = `id, username, role, allowed_views, is_active, created_at, updated_at, last_login_at`;

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    allowed_views: effectiveViews(row.role, row.allowed_views),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  };
}

async function listUsers() {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY LOWER(username) ASC`
  );
  return rows.map(toPublicUser);
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByUsername(username) {
  const { rows } = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [
    String(username ?? ''),
  ]);
  return rows[0] || null;
}

async function countActiveAdmins(excludeId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM users
     WHERE role = 'admin' AND is_active = TRUE AND ($1::uuid IS NULL OR id <> $1)`,
    [excludeId || null]
  );
  return rows[0].count;
}

async function createUser({ username, password, role, allowedViews, isActive = true }) {
  const password_hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO users (username, password_hash, role, allowed_views, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [username.trim(), password_hash, role, allowedViews, isActive]
  );
  return toPublicUser(rows[0]);
}

/**
 * Only the fields present in `changes` are written. A password change bumps
 * token_version so sessions holding the old password are signed out.
 */
async function updateUser(id, changes) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const values = [];

  const push = (fragment, value) => {
    values.push(value);
    sets.push(`${fragment} = $${values.length}`);
  };

  if (changes.role !== undefined) push('role', changes.role);
  if (changes.allowedViews !== undefined) push('allowed_views', changes.allowedViews);
  if (changes.isActive !== undefined) push('is_active', changes.isActive);
  if (changes.username !== undefined) push('username', changes.username.trim());
  if (changes.password !== undefined) {
    push('password_hash', await hashPassword(changes.password));
    sets.push('token_version = token_version + 1');
  }

  values.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${PUBLIC_COLUMNS}`,
    values
  );
  return toPublicUser(rows[0]);
}

async function deleteUser(id) {
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

async function recordLogin(id) {
  await db.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
}

/**
 * Verify credentials against the users table.
 *
 * Unknown usernames still run a password derivation against a throwaway hash so
 * the response time does not reveal which usernames exist.
 */
async function authenticate(username, password) {
  const user = await findByUsername(username);
  const ok = await verifyPassword(password, user?.password_hash);

  if (!user || !ok) return { ok: false, reason: 'invalid' };
  if (!user.is_active) return { ok: false, reason: 'disabled' };

  await recordLogin(user.id);
  return { ok: true, user };
}

/**
 * Shape a user row into the identity the rest of the request pipeline reads.
 */
function toRequestUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    views: effectiveViews(row.role, row.allowed_views),
    can_write: canWrite(row.role),
    is_admin: isAdmin(row.role),
    token_version: row.token_version,
  };
}

/**
 * Seed the first admin from AUTH_USERNAME / AUTH_PASSWORD.
 *
 * Runs only while the table is empty, so an admin who later changes their
 * password in the UI is not reset back to the value still sitting in .env.
 */
async function bootstrapFirstAdmin() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count > 0) return null;

  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) {
    console.warn(
      'No dashboard users exist and AUTH_USERNAME/AUTH_PASSWORD are not set, so nobody can sign in. ' +
        'Set both in .env and restart, or run: node backend/scripts/reset-user-password.js <username> <password>'
    );
    return null;
  }

  const user = await createUser({
    username,
    password,
    role: 'admin',
    allowedViews: ASSIGNABLE_VIEWS,
  });
  console.log(`Seeded first admin user "${user.username}" from AUTH_USERNAME/AUTH_PASSWORD.`);
  return user;
}

module.exports = {
  listUsers,
  findById,
  findByUsername,
  countActiveAdmins,
  createUser,
  updateUser,
  deleteUser,
  authenticate,
  toPublicUser,
  toRequestUser,
  bootstrapFirstAdmin,
};
