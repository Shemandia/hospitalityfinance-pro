/**
 * Repair script — rebuild the opening-balance chain for existing tenant data.
 *
 * Every account_period_balances row written before the carry-forward fix has
 * opening_balance = 0, so its closing_balance holds only that period's own
 * movement. This walks each entity's periods oldest-first and restates
 * opening/closing balances into true cumulative positions.
 *
 * Reads no journals and writes no journals: it only restates the balance rows
 * that postings already maintain. Safe to re-run — the engine is idempotent.
 *
 * Usage:
 *   # dry run (default) — computes everything, prints the diff, rolls back
 *   DATABASE_URL=… pnpm tsx src/scripts/rebuild-opening-balances.ts
 *
 *   # dry run for one entity
 *   DATABASE_URL=… pnpm tsx src/scripts/rebuild-opening-balances.ts --entity <id>
 *
 *   # commit the changes
 *   DATABASE_URL=… pnpm tsx src/scripts/rebuild-opening-balances.ts --apply
 *
 * THIS RUNS AGAINST LIVE HOTEL DATA. Take a backup before using --apply.
 */

import { PrismaClient, Prisma } from "../db/client.js";
import { rebuildOpeningBalances } from "../modules/period/carry-forward.js";
import { requireConfig } from "../config.js";

type BalanceSnapshot = {
  entity_id: string;
  account_code: string;
  period_label: string;
  opening_balance: string;
  closing_balance: string;
};

/** Thrown to force a rollback at the end of a dry run. */
class DryRunRollback extends Error {
  constructor(public readonly report: string[]) {
    super("dry run — rolling back");
  }
}

async function snapshot(tx: any, entityId: string): Promise<Map<string, BalanceSnapshot>> {
  const rows = await tx.$queryRaw<BalanceSnapshot[]>`
    SELECT
      b.entity_id,
      a.code AS account_code,
      p.year || '-' || LPAD(p.month::text, 2, '0') AS period_label,
      b.opening_balance::text AS opening_balance,
      b.closing_balance::text AS closing_balance
    FROM account_period_balances b
    JOIN accounts a ON a.id = b.account_id
    JOIN periods  p ON p.id = b.period_id
    WHERE b.entity_id = ${entityId}
    ORDER BY p.year, p.month, a.code
  `;
  const map = new Map<string, BalanceSnapshot>();
  for (const r of rows) map.set(`${r.period_label}|${r.account_code}`, r);
  return map;
}

function diffReport(
  entityName: string,
  before: Map<string, BalanceSnapshot>,
  after: Map<string, BalanceSnapshot>
): string[] {
  const lines: string[] = [];
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();

  for (const key of keys) {
    const b = before.get(key);
    const a = after.get(key);
    if (!a) continue;

    if (!b) {
      lines.push(
        `  + ${key.padEnd(28)} NEW    opening=${a.opening_balance} closing=${a.closing_balance}`
      );
      continue;
    }
    const openChanged = Number(b.opening_balance) !== Number(a.opening_balance);
    const closeChanged = Number(b.closing_balance) !== Number(a.closing_balance);
    if (openChanged || closeChanged) {
      lines.push(
        `  ~ ${key.padEnd(28)} opening ${b.opening_balance} → ${a.opening_balance}` +
          `   closing ${b.closing_balance} → ${a.closing_balance}`
      );
    }
  }

  return lines.length > 0
    ? [`Entity ${entityName}: ${lines.length} row(s) restated`, ...lines]
    : [`Entity ${entityName}: already correct, nothing to change`];
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const entityArgIndex = args.indexOf("--entity");
  const onlyEntityId = entityArgIndex >= 0 ? args[entityArgIndex + 1] : undefined;

  const prisma = new PrismaClient({
    datasourceUrl: requireConfig(["DATABASE_URL"], "rebuild-opening-balances").DATABASE_URL
  });

  try {
    const entities = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM entities
      ${onlyEntityId ? Prisma.sql`WHERE id = ${onlyEntityId}` : Prisma.empty}
      ORDER BY name
    `;

    if (entities.length === 0) {
      console.log("No entities found.");
      return;
    }

    console.log(
      apply
        ? `APPLY mode — changes will be committed for ${entities.length} entity(ies).`
        : `DRY RUN — computing changes for ${entities.length} entity(ies), then rolling back.\n` +
            `Re-run with --apply to commit.`
    );

    const report: string[] = [];

    try {
      await prisma.$transaction(
        async (tx) => {
          for (const entity of entities) {
            // Carry-forward filters by entity_id explicitly, but RLS policies
            // still need the tenant context for the tables it touches.
            await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;

            const before = await snapshot(tx, entity.id);
            await rebuildOpeningBalances(tx, entity.id);
            const after = await snapshot(tx, entity.id);

            report.push(...diffReport(entity.name, before, after), "");
          }

          if (!apply) throw new DryRunRollback(report);
        },
        { timeout: 15 * 60 * 1000 }
      );
    } catch (err) {
      if (!(err instanceof DryRunRollback)) throw err;
      console.log(err.report.join("\n"));
      console.log("DRY RUN complete — no changes were written.");
      return;
    }

    console.log(report.join("\n"));
    console.log("Opening balances rebuilt and committed.");
    console.log(
      "Refresh the reporting view next: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_period_account_balances;"
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
