const db = require('../src/db');

async function main() {
  const { rows: cols } = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users' ORDER BY ordinal_position`
  );
  console.log('columns:', cols.map((c) => c.column_name).join(', '));
  const { rows } = await db.query(
    `SELECT username, role, allowed_views, is_active FROM users ORDER BY username`
  );
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
