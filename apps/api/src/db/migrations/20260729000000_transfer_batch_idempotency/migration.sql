-- Transfer Desk import idempotency and resumable commit.
--
-- Re-uploading the same source file — after a timeout, a retry, or operator
-- error — staged a second batch, which committed a second set of GL journals
-- and posted the night's revenue twice. And commitBatch flipped the batch to
-- COMMITTED before posting a single item, so an interruption part-way through
-- left items HELD inside a batch that reported itself finished; a re-run saw a
-- non-PENDING_REVIEW status and did nothing, stranding them permanently.
--
-- Both additions are safe on live data: the column is nullable, and the new
-- enum value is only reachable from code paths added alongside it.

-- ── Resumable commit ─────────────────────────────────────────────────────────
-- COMMITTING marks a commit as in flight. It is set before the first item is
-- posted and cleared only once every item has been processed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TransferBatchStatus' AND e.enumlabel = 'COMMITTING'
  ) THEN
    ALTER TYPE "TransferBatchStatus" ADD VALUE 'COMMITTING' BEFORE 'COMMITTED';
  END IF;
END $$;

-- ── Import idempotency ───────────────────────────────────────────────────────
-- SHA-256 of the mapped source records. NULL for batches staged before this
-- existed; Postgres treats NULLs as distinct in a unique index, so historical
-- rows never collide with each other or with new ones.

ALTER TABLE transfer_batches
  ADD COLUMN IF NOT EXISTS source_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS transfer_batches_entity_profile_source_hash_key
  ON transfer_batches (entity_id, profile_id, source_hash);
