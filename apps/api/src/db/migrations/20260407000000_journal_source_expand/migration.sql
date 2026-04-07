-- Expand JournalSource enum per Financials Admin spec FA-ENUM-001.
-- Adds the 7 source values used by Transfer Desk imports and period-end
-- processes (system rounding, payments, depreciation, allocations, revaluation).

ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'IMPORT';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'SYSTM';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'PAYMT';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'PAYDS';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'DEPRC';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'ALLOC';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'REVAL';
