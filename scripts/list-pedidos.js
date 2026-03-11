const { dbAll, initDatabase } = require("../db");

async function main() {
  await initDatabase();
  const rows = await dbAll(
    "SELECT pedido_id, token, revenda, status FROM pedidos ORDER BY pedido_id"
  );
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
