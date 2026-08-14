const db = require('../src/db');

async function main() {
  const { rows: projects } = await db.query(
    'SELECT id, name, description, color FROM projects ORDER BY created_at'
  );
  const out = { projects: [] };
  for (const p of projects) {
    const { rows: boards } = await db.query('SELECT id, name FROM boards WHERE project_id = $1', [
      p.id,
    ]);
    const board = boards[0];
    let columns = [];
    if (board) {
      const { rows } = await db.query(
        `SELECT c.name, COUNT(t.id)::int AS tasks
         FROM columns c
         LEFT JOIN tasks t ON t.column_id = c.id
         WHERE c.board_id = $1
         GROUP BY c.name, c.position
         ORDER BY c.position`,
        [board.id]
      );
      columns = rows;
    }
    out.projects.push({ ...p, board: board || null, columns });
  }
  try {
    const { rows: users } = await db.query(
      'SELECT username, role, can_write, views FROM users ORDER BY username'
    );
    out.users = users;
  } catch (err) {
    out.users_error = err.message;
  }
  console.log(JSON.stringify(out, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
