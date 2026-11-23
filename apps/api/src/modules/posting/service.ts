/**
 * The posting service (docs/IMPORT-PLAN.md section 2, step 4): the one way a
 * canonical GL journal document reaches the ledger.
 *
 *   1. Contract   the document is checked and normalised (@hfp/posting-contract).
 *   2. Resolve    every code to an active record of the entity: entity, source
 *                 system, journal type, accounts, dimension names and values.
 *   3. Period     the entity's period for the month of documentDate; it must
 *                 be open. No other period is ever used instead.
 *   4. Rate       1 for the entity's currency; otherwise the document's rate,
 *                 or the latest rate of the profile's rate type on or before
 *                 documentDate.
 *   5. Duplicate  a document already posted for the entity and source system
 *                 is reported as a duplicate, and the database's unique index
 *                 makes that hold when two posts race.
 *   6. Post       written and posted in one transaction, as the given user
 *                 (the tenant's system user for scheduled imports), under the
 *                 normal approval and authorization rules.
 *
 * Reverse-and-replace (owner decision 5) swaps a posted document for a
 * corrected one: in one transaction the original is reversed and the new one
 * posted as the next revision, with an audit event naming all three. The
 * caller checks INTEGRATIONS_REPLACE.
 */
import {
  AMOUNT_SCALE,
  type NormalizedGlJournal,
  type NormalizedGlLine,
  fromScaled,
  toScaled,
  validateGlJournal
} from "@hfp/posting-contract";
import type { Prisma, PrismaClient } from "../../db/client.js";
import { getRequestContext, runWithContext } from "../../db/requestContext.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { clearEntityDbContext, setEntityDbContext } from "../../db/tenantContext.js";
import { AuditService } from "../audit/service.js";
import { GLService, GLServiceError, type WriteAndPostResult } from "../gl/service.js";
import type { JournalWriteInput } from "../gl/types.js";
import { type PostingError, PostingErrorCode } from "./errors.js";

export type JournalSource = JournalWriteInput["source"];
export type FxRateType = "SPOT" | "AVERAGE" | "BUDGET" | "CLOSING";

export type PostingOptions = {
  /** Recorded as the creator and poster: a person, or the tenant's system user. */
  actorUserId: string;
  /** The ledger's journal source; revenue accounts accept only PMS and POS by default. */
  journalSource?: JournalSource;
  /** Rate type for documents without a rate (the profile's); SPOT when unset. */
  fxRateType?: FxRateType;
  /** Check everything, write nothing. */
  dryRun?: boolean;
};

export type PostingOutcome =
  | {
      status: "POSTED" | "PENDING_APPROVAL" | "AWAITING_AUTHORIZATION";
      journalId: string;
      entityId: string;
    }
  | { status: "VALID"; entityId: string }
  | { status: "DUPLICATE"; journalId: string; entityId: string }
  | { status: "REFUSED"; errors: PostingError[] };

type PreparedDocument = {
  kind: "ready";
  entityId: string;
  doc: NormalizedGlJournal;
  input: JournalWriteInput;
};

export type ReplaceOutcome =
  | {
      status: "REPLACED";
      originalJournalId: string;
      reversalJournalId: string;
      journalId: string;
      replacementStatus: WriteAndPostResult["status"];
      revision: number;
    }
  | { status: "REFUSED"; errors: PostingError[] };

type Resolved = {
  entityId: string;
  input: JournalWriteInput;
};

class Refused extends Error {
  constructor(readonly errors: PostingError[]) {
    super(errors.map((e) => e.message).join("; "));
  }
}

const refused = (code: string, message: string, path = ""): Refused =>
  new Refused([{ code, path, message }]);

/** The outcome for an error the service reports as a refusal; null for anything else. */
function refusal(error: unknown): PostingOutcome | null {
  if (error instanceof Refused) return { status: "REFUSED", errors: error.errors };
  if (error instanceof GLServiceError) {
    return {
      status: "REFUSED",
      errors: [
        {
          code: PostingErrorCode.LEDGER_REFUSED,
          path: "",
          message: `${error.code}: ${error.message}`
        }
      ]
    };
  }
  return null;
}

/**
 * A unique violation while writing. Prisma does not always name the
 * constraint (inside an interactive transaction it may say "not available"),
 * so the caller checks whether the document now exists before calling it a
 * duplicate.
 */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2002";
}

export class PostingService {
  private readonly gl: GLService;

  constructor(private readonly prisma: PrismaClient) {
    this.gl = new GLService(prisma);
  }

  /** Posts a GL journal document (any input: it is checked against the contract first). */
  async post(input: unknown, options: PostingOptions): Promise<PostingOutcome> {
    const ready = await this.prepareDocument(input, options);
    if (ready.kind === "outcome") return ready.outcome;
    if (options.dryRun) return { status: "VALID", entityId: ready.entityId };
    try {
      return await this.asEntity(ready.entityId, async () => {
        let result: WriteAndPostResult;
        try {
          result = await this.inTransaction(ready.entityId, (tx) =>
            this.gl.writeAndPostInTransaction(tx, ready.entityId, options.actorUserId, ready.input)
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            const raced = await this.latestPosting(ready.entityId, ready.doc);
            if (raced)
              return { status: "DUPLICATE", journalId: raced.id, entityId: ready.entityId };
          }
          throw error;
        }
        await this.gl.afterWrite(ready.entityId, result);
        return { status: result.status, journalId: result.journalId, entityId: ready.entityId };
      });
    } catch (error) {
      const outcome = refusal(error);
      if (outcome) return outcome;
      throw error;
    }
  }

  /**
   * Posts every document or none (a profile's WHOLE_FILE atomicity): all are
   * checked first, and only if every one would post are they written, in one
   * transaction. Outcomes are in the order of `inputs`; when the file is not
   * posted, the documents that were fine are refused with FILE_NOT_POSTED.
   */
  async postAll(
    inputs: ReadonlyArray<unknown>,
    options: PostingOptions
  ): Promise<PostingOutcome[]> {
    const prepared: PreparedDocument[] = [];
    const outcomes: Array<PostingOutcome | null> = [];
    for (const input of inputs) {
      const ready = await this.prepareDocument(input, options);
      if (ready.kind === "outcome") outcomes.push(ready.outcome);
      else {
        outcomes.push(null);
        prepared.push(ready);
      }
    }
    const notPosted = (because: string): PostingOutcome[] =>
      outcomes.map(
        (o) =>
          o ?? {
            status: "REFUSED",
            errors: [{ code: PostingErrorCode.FILE_NOT_POSTED, path: "", message: because }]
          }
      );
    if (outcomes.some((o) => o !== null)) {
      return notPosted(
        "Not posted: another document of the file was refused or is a duplicate, and the profile posts whole files only."
      );
    }
    if (options.dryRun) return prepared.map((p) => ({ status: "VALID", entityId: p.entityId }));

    let results: WriteAndPostResult[];
    try {
      results = await this.prisma.$transaction(
        async (tx) => {
          const written: WriteAndPostResult[] = [];
          for (const doc of prepared) {
            written.push(
              await this.asEntity(doc.entityId, async () => {
                await setEntityDbContext(tx, doc.entityId);
                return this.gl.writeAndPostInTransaction(
                  tx,
                  doc.entityId,
                  options.actorUserId,
                  doc.input
                );
              })
            );
          }
          return written;
        },
        { timeout: 120_000 }
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return notPosted(
          "Not posted: a document of the file was posted by another import at the same time."
        );
      }
      const outcome = refusal(error);
      if (outcome) {
        const reason =
          outcome.status === "REFUSED" ? outcome.errors.map((e) => e.message).join("; ") : "";
        return notPosted(`Not posted: the ledger refused a document of the file (${reason}).`);
      }
      throw error;
    } finally {
      clearEntityDbContext();
    }
    for (let i = 0; i < prepared.length; i++) {
      await this.asEntity(prepared[i]!.entityId, () =>
        this.gl.afterWrite(prepared[i]!.entityId, results[i]!)
      );
    }
    return results.map((r, i) => ({
      status: r.status,
      journalId: r.journalId,
      entityId: prepared[i]!.entityId
    }));
  }

  /**
   * Everything before the write: contract, codes, period, rate, duplicate,
   * ledger rules. Writes nothing.
   */
  private async prepareDocument(
    input: unknown,
    options: PostingOptions
  ): Promise<PreparedDocument | { kind: "outcome"; outcome: PostingOutcome }> {
    const contract = validateGlJournal(input);
    if (!contract.ok)
      return { kind: "outcome", outcome: { status: "REFUSED", errors: contract.errors } };
    const doc = contract.document;
    try {
      const entity = await this.entity(doc.entityCode);
      return await this.asEntity(entity.id, async () => {
        const resolved = await this.resolve(doc, entity, options);
        const existing = await this.latestPosting(entity.id, doc);
        if (existing) {
          return {
            kind: "outcome",
            outcome: { status: "DUPLICATE", journalId: existing.id, entityId: entity.id }
          };
        }
        return { kind: "ready", entityId: entity.id, doc, input: await this.prepare(resolved) };
      });
    } catch (error) {
      const outcome = refusal(error);
      if (outcome) return { kind: "outcome", outcome };
      throw error;
    }
  }

  /**
   * Replaces the posted journal of a source document with `input` (the same
   * entity, source system and reference): reverses the original in its own
   * period and posts `input` as the next revision, in one transaction.
   */
  async replace(
    input: unknown,
    options: Omit<PostingOptions, "dryRun"> & { reason: string }
  ): Promise<ReplaceOutcome> {
    const contract = validateGlJournal(input);
    if (!contract.ok) return { status: "REFUSED", errors: contract.errors };
    const doc = contract.document;
    try {
      if (!options.reason?.trim()) {
        throw refused(
          PostingErrorCode.REASON_REQUIRED,
          "A reason is required to replace a posted document."
        );
      }
      const entity = await this.entity(doc.entityCode);
      return await this.asEntity(entity.id, async () => {
        const original = await this.latestPosting(entity.id, doc);
        if (!original) {
          throw refused(
            PostingErrorCode.NOTHING_TO_REPLACE,
            `No journal of ${doc.sourceSystem} ${doc.sourceDocumentRef} to replace for ${doc.entityCode}.`
          );
        }
        if (original.status !== "POSTED") {
          throw refused(
            PostingErrorCode.REPLACE_NOT_POSTED,
            `The journal of ${doc.sourceDocumentRef} is ${original.status}; only a posted journal can be replaced.`
          );
        }
        const resolved = await this.resolve(doc, entity, options);
        const revision = original.sourceRevision + 1;
        const replacement = await this.prepare({
          ...resolved,
          input: { ...resolved.input, sourceRevision: revision, replacesJournalId: original.id }
        });
        const reversal = this.reversalOf(original);

        const outcome = await this.inTransaction(entity.id, async (tx) => {
          const reversed = await this.gl.writeAndPostInTransaction(
            tx,
            entity.id,
            options.actorUserId,
            reversal
          );
          if (reversed.status !== "POSTED") {
            throw refused(
              PostingErrorCode.REVERSAL_NEEDS_APPROVAL,
              "The reversal of the original would need approval, so the document cannot be replaced in one step; reverse it on screen instead."
            );
          }
          const posted = await this.gl.writeAndPostInTransaction(
            tx,
            entity.id,
            options.actorUserId,
            replacement
          );
          await AuditService.createEventInTx(tx as unknown as PrismaClient, {
            entityId: entity.id,
            userId: options.actorUserId,
            eventType: "JOURNAL_REPLACED",
            resourceType: "journal",
            resourceId: posted.journalId,
            beforeState: {
              journalId: original.id,
              sourceSystem: doc.sourceSystem,
              sourceDocumentRef: doc.sourceDocumentRef,
              sourceRevision: original.sourceRevision
            },
            afterState: {
              reversalJournalId: reversed.journalId,
              replacementJournalId: posted.journalId,
              replacementStatus: posted.status,
              sourceRevision: revision,
              reason: options.reason.trim()
            }
          });
          return { reversed, posted };
        });
        await this.gl.afterWrite(entity.id, outcome.posted);
        return {
          status: "REPLACED",
          originalJournalId: original.id,
          reversalJournalId: outcome.reversed.journalId,
          journalId: outcome.posted.journalId,
          replacementStatus: outcome.posted.status,
          revision
        };
      });
    } catch (error) {
      if (error instanceof Refused) return { status: "REFUSED", errors: error.errors };
      if (error instanceof GLServiceError) {
        return {
          status: "REFUSED",
          errors: [
            {
              code: PostingErrorCode.LEDGER_REFUSED,
              path: "",
              message: `${error.code}: ${error.message}`
            }
          ]
        };
      }
      throw error;
    }
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  /** The entity of a code. Entities are read across the tenant: the document names its own. */
  private async entity(code: string) {
    const entity = await withBypassRLS(this.prisma, (tx: Prisma.TransactionClient) =>
      tx.entity.findUnique({
        where: { code },
        select: { id: true, code: true, isActive: true, functionalCurrency: true }
      })
    );
    if (!entity)
      throw refused(
        PostingErrorCode.ENTITY_NOT_FOUND,
        `No entity with code ${code}.`,
        "entityCode"
      );
    if (!entity.isActive)
      throw refused(PostingErrorCode.ENTITY_INACTIVE, `Entity ${code} is inactive.`, "entityCode");
    return entity;
  }

  /** Runs `fn` with the entity bound, as a request for that entity would be. */
  private asEntity<T>(entityId: string, fn: () => Promise<T>): Promise<T> {
    return runWithContext({ ...getRequestContext(), entityId }, fn);
  }

  private async inTransaction<T>(
    entityId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await setEntityDbContext(tx, entityId);
        return fn(tx);
      });
    } finally {
      clearEntityDbContext();
    }
  }

  private latestPosting(entityId: string, doc: NormalizedGlJournal) {
    return this.prisma.journal.findFirst({
      where: { entityId, sourceSystem: doc.sourceSystem, sourceDocumentRef: doc.sourceDocumentRef },
      orderBy: { sourceRevision: "desc" },
      include: { lines: { orderBy: { lineNumber: "asc" } }, period: true }
    });
  }

  private async prepare(resolved: Resolved): Promise<JournalWriteInput> {
    return this.gl.prepareJournal(resolved.entityId, resolved.input);
  }

  /** Resolves every code of the document; collects every problem before refusing. */
  private async resolve(
    doc: NormalizedGlJournal,
    entity: { id: string; code: string; functionalCurrency: string },
    options: PostingOptions
  ): Promise<Resolved> {
    const errors: PostingError[] = [];
    const add = (code: string, message: string, path: string) =>
      errors.push({ code, path, message });
    const db = this.prisma;

    const source = await db.sourceSystem.findUnique({ where: { code: doc.sourceSystem } });
    if (!source)
      add(
        PostingErrorCode.SOURCE_SYSTEM_NOT_FOUND,
        `No source system ${doc.sourceSystem}.`,
        "sourceSystem"
      );
    else if (!source.isActive)
      add(
        PostingErrorCode.SOURCE_SYSTEM_INACTIVE,
        `Source system ${doc.sourceSystem} is inactive.`,
        "sourceSystem"
      );

    const [year, month] = doc.documentDate.split("-").map(Number) as [number, number];
    const period = await db.period.findFirst({ where: { entityId: entity.id, year, month } });
    const monthName = `${year}-${String(month).padStart(2, "0")}`;
    if (!period)
      add(
        PostingErrorCode.NO_PERIOD,
        `${entity.code} has no period for ${monthName}.`,
        "documentDate"
      );
    else if (period.status !== "OPEN")
      add(
        PostingErrorCode.PERIOD_NOT_OPEN,
        `Period ${period.name} of ${entity.code} is ${period.status}.`,
        "documentDate"
      );

    let journalTypeId: string | undefined;
    if (doc.journalTypeCode) {
      const type = await db.journalType.findFirst({
        where: { entityId: entity.id, code: doc.journalTypeCode }
      });
      if (!type)
        add(
          PostingErrorCode.JOURNAL_TYPE_NOT_FOUND,
          `No journal type ${doc.journalTypeCode} in ${entity.code}.`,
          "journalTypeCode"
        );
      else journalTypeId = type.id;
    }

    const codes = [...new Set(doc.lines.map((l) => l.accountCode))];
    const accounts = new Map(
      (await db.account.findMany({ where: { entityId: entity.id, code: { in: codes } } })).map(
        (a) => [a.code, a]
      )
    );
    const dimensions = await db.analysisDimension.findMany({
      where: { entityId: entity.id },
      include: { codes: { where: { isActive: true }, select: { code: true } } }
    });
    const byName = new Map(dimensions.map((d) => [d.dimensionName, d]));

    const rate = await this.rate(doc, entity.functionalCurrency, options, add);

    const lines = doc.lines.map((line: NormalizedGlLine, i) => {
      const at = (field: string) => `lines.${i}.${field}`;
      const account = accounts.get(line.accountCode);
      const money =
        toScaled(line.debit, AMOUNT_SCALE) !== 0n || toScaled(line.credit, AMOUNT_SCALE) !== 0n;
      if (!account) {
        add(
          PostingErrorCode.ACCOUNT_NOT_FOUND,
          `No account ${line.accountCode} in ${entity.code}.`,
          at("accountCode")
        );
      } else if (!account.isActive || !account.allowPosting) {
        add(
          PostingErrorCode.ACCOUNT_NOT_POSTABLE,
          `Account ${line.accountCode} is ${account.isActive ? "closed to posting" : "inactive"}.`,
          at("accountCode")
        );
      } else if (account.type === "STATISTICAL" && money) {
        add(
          PostingErrorCode.AMOUNT_ON_STATISTICAL_ACCOUNT,
          `Account ${line.accountCode} is statistical; it takes a quantity, not an amount.`,
          at("accountCode")
        );
      } else if (account.type !== "STATISTICAL" && line.statValue !== undefined) {
        add(
          PostingErrorCode.STAT_VALUE_ON_FINANCIAL_ACCOUNT,
          `Account ${line.accountCode} is not statistical; it takes no quantity.`,
          at("statValue")
        );
      }
      if (line.taxCode) {
        add(
          PostingErrorCode.TAX_CODE_NOT_SUPPORTED,
          "Journal lines do not carry tax codes yet (WP-U).",
          at("taxCode")
        );
      }

      const columns: Record<string, string> = {};
      for (const [name, value] of Object.entries(line.dimensions)) {
        const dimension = byName.get(name);
        if (!dimension) {
          add(
            PostingErrorCode.DIMENSION_NOT_FOUND,
            `${entity.code} has no dimension named ${name}.`,
            at(`dimensions.${name}`)
          );
          continue;
        }
        if (dimension.validationType === "LIST" && !dimension.codes.some((c) => c.code === value)) {
          add(
            PostingErrorCode.DIMENSION_VALUE_NOT_FOUND,
            `${value} is not a code of dimension ${name}.`,
            at(`dimensions.${name}`)
          );
        }
        columns[`dimension${dimension.dimensionNumber}`] = value;
      }
      for (const dimension of dimensions) {
        if (dimension.isRequired && !(dimension.dimensionName in line.dimensions)) {
          add(
            PostingErrorCode.DIMENSION_REQUIRED,
            `Dimension ${dimension.dimensionName} is required.`,
            at("dimensions")
          );
        }
      }

      return {
        accountId: account?.id ?? "",
        debit: line.debit,
        credit: line.credit,
        currency: doc.currency,
        fxRate: rate,
        ...(line.description !== undefined && { description: line.description }),
        ...(line.statValue !== undefined && { statValue: line.statValue }),
        ...columns,
        lineNumber: line.lineNumber
      };
    });

    if (errors.length > 0) throw new Refused(errors);
    return {
      entityId: entity.id,
      input: {
        periodId: period!.id,
        ...(journalTypeId && { journalTypeId }),
        ...(doc.description !== undefined && { description: doc.description }),
        source: options.journalSource ?? "IMPORT",
        functionalCurrency: entity.functionalCurrency,
        documentDate: doc.documentDate,
        sourceSystem: doc.sourceSystem,
        sourceDocumentRef: doc.sourceDocumentRef,
        sourceRevision: 0,
        lines
      } as JournalWriteInput
    };
  }

  private async rate(
    doc: NormalizedGlJournal,
    functionalCurrency: string,
    options: PostingOptions,
    add: (code: string, message: string, path: string) => void
  ): Promise<string> {
    if (doc.currency === functionalCurrency) {
      if (doc.fxRate !== undefined && toScaled(doc.fxRate, 8) !== 100_000_000n) {
        add(
          PostingErrorCode.RATE_FOR_FUNCTIONAL_CURRENCY,
          `${doc.currency} is the entity's own currency; its rate is 1.`,
          "fxRate"
        );
      }
      return "1";
    }
    if (doc.fxRate !== undefined) return doc.fxRate;
    const rateType = options.fxRateType ?? "SPOT";
    const found = await this.prisma.fXRate.findFirst({
      where: {
        fromCurrency: doc.currency,
        toCurrency: functionalCurrency,
        rateType,
        effectiveDate: { lte: new Date(`${doc.documentDate}T00:00:00Z`) }
      },
      orderBy: { effectiveDate: "desc" }
    });
    if (!found) {
      add(
        PostingErrorCode.NO_RATE,
        `No ${rateType} rate ${doc.currency}/${functionalCurrency} on or before ${doc.documentDate}.`,
        "currency"
      );
      return "1";
    }
    return found.rate.toString();
  }

  /** The reversal of a posted journal: every line on the other side, in the original's period and date. */
  private reversalOf(
    original: NonNullable<Awaited<ReturnType<PostingService["latestPosting"]>>>
  ): JournalWriteInput {
    const negate = (v: { toString(): string } | null) =>
      v === null ? undefined : fromScaled(-toScaled(v.toString(), 3), 3);
    return {
      periodId: original.periodId,
      ...(original.journalTypeId && { journalTypeId: original.journalTypeId }),
      description: `Reversal of ${original.sourceSystem} ${original.sourceDocumentRef} (replaced)`,
      source: original.source as JournalSource,
      functionalCurrency: original.functionalCurrency,
      documentDate: original.documentDate!.toISOString().slice(0, 10),
      reversalOfId: original.id,
      lines: original.lines.map((line) => ({
        accountId: line.accountId,
        debit: line.credit.toString(),
        credit: line.debit.toString(),
        currency: line.currency,
        fxRate: line.fxRate.toString(),
        ...(line.description && { description: line.description }),
        ...(line.statValue !== null && { statValue: negate(line.statValue) }),
        dimension1: line.dimension1 ?? undefined,
        dimension2: line.dimension2 ?? undefined,
        dimension3: line.dimension3 ?? undefined,
        dimension4: line.dimension4 ?? undefined,
        dimension5: line.dimension5 ?? undefined,
        dimension6: line.dimension6 ?? undefined,
        dimension7: line.dimension7 ?? undefined,
        dimension8: line.dimension8 ?? undefined,
        dimension9: line.dimension9 ?? undefined,
        dimension10: line.dimension10 ?? undefined,
        lineNumber: line.lineNumber
      }))
    } as JournalWriteInput;
  }
}
