import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function run() {
  const ENTITY_ID = "00000000-0000-0000-0000-000000000002";

  // Check CBORA001 specifically — all fields
  const rows: Array<{
    code: string;
    reference: string | null;
    debit: number;
    credit: number;
    debit_functional: number;
    credit_functional: number;
  }> = await p.$queryRaw`
    SELECT a.code, j.reference,
           jl.debit, jl.credit,
           jl.debit_functional, jl.credit_functional
    FROM journal_lines jl
    JOIN journals j ON jl.journal_id = j.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE j.entity_id = ${ENTITY_ID}
      AND a.code = 'CBORA001'
    ORDER BY j.created_at
  `;

  console.log("CBORA001 — All journal lines (debit/credit vs functional):");
  console.log("─".repeat(100));
  for (const r of rows) {
    const ref = (r.reference ?? "").padEnd(30);
    console.log(
      `  ${ref} debit=${Number(r.debit).toLocaleString().padStart(12)} credit=${Number(r.credit).toLocaleString().padStart(12)} | Dr_func=${Number(r.debit_functional).toLocaleString().padStart(12)} Cr_func=${Number(r.credit_functional).toLocaleString().padStart(12)}`
    );
  }

  await p.$disconnect();
}

run();
