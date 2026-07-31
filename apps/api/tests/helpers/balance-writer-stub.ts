/**
 * Test stub for the canonical balance writer's SQL call.
 *
 * db/balance-writer.ts issues one parameterised INSERT … RETURNING account_id
 * through $queryRawUnsafe, and treats a short result as "an account did not
 * exist" — it throws rather than let a balance movement vanish silently. A
 * stub that returns [] would therefore fail every test that posts anything.
 *
 * This fake reads the account ids back out of the parameter list the writer
 * builds ($1 = entityId, $2 = periodId, then accountId/debit/credit triples)
 * and echoes them, which is what a successful write returns.
 */
export function makeBalanceWriterStub() {
  return async (_sql: string, ...params: unknown[]): Promise<Array<{ account_id: string }>> => {
    const rows: Array<{ account_id: string }> = [];
    for (let i = 2; i < params.length; i += 3) {
      rows.push({ account_id: String(params[i]) });
    }
    return rows;
  };
}
