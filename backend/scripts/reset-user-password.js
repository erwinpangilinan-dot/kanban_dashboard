/**
 * Lock-out recovery: set a user's password from the command line, creating the
 * account as an admin if it does not exist yet.
 *
 * Usage:
 *   node scripts/reset-user-password.js <username> <password> [--role admin|editor|viewer]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const db = require('../src/db');
const users = require('../src/services/users');
const { validatePassword } = require('../src/lib/password');
const { ASSIGNABLE_VIEWS, isValidRole } = require('../src/lib/permissions');

async function main() {
  const args = process.argv.slice(2);
  const roleIndex = args.indexOf('--role');
  const role = roleIndex >= 0 ? args[roleIndex + 1] : 'admin';
  const positional = args.filter((arg, i) => arg !== '--role' && i !== roleIndex + 1);
  const [username, password] = positional;

  if (!username || !password) {
    console.error('Usage: node scripts/reset-user-password.js <username> <password> [--role admin|editor|viewer]');
    process.exit(1);
  }

  if (!isValidRole(role)) {
    console.error(`Invalid role "${role}". Use admin, editor, or viewer.`);
    process.exit(1);
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    console.error(passwordError);
    process.exit(1);
  }

  const existing = await users.findByUsername(username);
  if (existing) {
    await users.updateUser(existing.id, { password, isActive: true });
    console.log(`Password reset for "${existing.username}" (role: ${existing.role}). Other sessions signed out.`);
  } else {
    const created = await users.createUser({
      username,
      password,
      role,
      allowedViews: ASSIGNABLE_VIEWS,
    });
    console.log(`Created ${created.role} user "${created.username}".`);
  }
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    console.error(err.message);
    await db.pool.end().catch(() => {});
    process.exit(1);
  });
