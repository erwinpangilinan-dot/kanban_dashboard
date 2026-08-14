const fs = require('fs');
const path = require('path');
const db = require('./db');

function resolveMigrationsDir() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.join(__dirname, '../../database/migrations'),
    path.join(process.cwd(), 'database/migrations'),
    path.join(process.cwd(), '../database/migrations'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  throw new Error('Migrations directory not found.');
}

/** Numeric version from `V12__foo.sql` so V8 runs before V10 (string sort does not). */
function migrationVersion(filename) {
  const match = /^V(\d+)__/i.exec(filename);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function listMigrationFiles(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.startsWith('V') && f.endsWith('.sql'))
    .sort((a, b) => migrationVersion(a) - migrationVersion(b) || a.localeCompare(b));
}

async function migrate() {
  const migrationsDir = resolveMigrationsDir();
  const files = listMigrationFiles(migrationsDir);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.query(sql);
    console.log(`Applied migration: ${file}`);
  }
}

module.exports = { migrate, migrationVersion, listMigrationFiles };
