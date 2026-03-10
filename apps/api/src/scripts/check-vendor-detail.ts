import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function run() {
  const ENTITY_ID = "00000000-0000-0000-0000-000000000002";

  // Check all journal lines for C-prefix accounts
  const rows: Array<{
    code: string;
    name: string;
    reference: string | null;
    status: string;
    debit: number;
    credit: number;
    description: string | null;
  }> = await p.$queryRaw`
    SELECT a.code, a.name, j.reference, j.status,
           jl.debit_functional AS debit, jl.credit_functional AS credit,
           j.description
    FROM journal_lines jl
    JOIN journals j ON jl.journal_id = j.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE j.entity_id = ${ENTITY_ID}
      AND a.code LIKE 'C%'
      AND j.status = 'POSTED'
    ORDER BY a.code, j.created_at
  `;

  let currentCode = "";
  let runningBalance = 0;
  for (const r of rows) {
    if (r.code.trim() !== currentCode) {
      if (currentCode) console.log(`  NET BALANCE: ${runningBalance.toLocaleString()}\n`);
      currentCode = r.code.trim();
      runningBalance = 0;
      console.log(`\n${currentCode} — ${r.name}`);
      console.log("─".repeat(90));
    }
    const dr = Number(r.debit);
    const cr = Number(r.credit);
    runningBalance += dr - cr;
    const ref = (r.reference ?? "").padEnd(30);
    console.log(`  ${ref} Dr ${dr.toLocaleString().padStart(14)} Cr ${cr.toLocaleString().padStart(14)}  running: ${runningBalance.toLocaleString()}`);
  }
  if (currentCode) console.log(`  NET BALANCE: ${runningBalance.toLocaleString()}`);

  await p.$disconnect();
}

run();
