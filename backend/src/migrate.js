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

async function migrate() {
  const migrationsDir = resolveMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.startsWith('V') && f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.query(sql);
    console.log(`Applied migration: ${file}`);
  }
}

module.exports = { migrate };
