import { PrismaClient } from "../db/client.js";

const p = new PrismaClient();

async function run() {
  const rows: Array<{ code: string; name: string; closing_balance: number }> = await p.$queryRaw`
      SELECT a.code, a.name, apb.closing_balance
      FROM account_period_balances apb
      JOIN accounts a ON apb.account_id = a.id
      WHERE a.code LIKE 'C%'
      ORDER BY a.code
    `;
  console.log("\nVendor Account Balances:");
  console.log("─".repeat(70));
  for (const r of rows) {
    const bal = Number(r.closing_balance);
    console.log(
      `${String(r.code).trim().padEnd(12)} ${String(r.name).padEnd(42)} ${bal.toLocaleString()}`
    );
  }
  console.log("─".repeat(70));
  await p.$disconnect();
}

run();
