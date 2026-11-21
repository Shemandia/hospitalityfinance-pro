/**
 * Integrations — the review mode of a run.
 *
 * Whether an import into the ledger is held for review or committed at once.
 * The checks on what is staged are the posting service's (modules/posting);
 * a held batch stores the canonical documents
 * (integration-import-documents.ts).
 */

/**
 * Scheduled and automation runs always commit (nobody is there to review);
 * an interactive run follows the profile, and holds unless the profile says
 * AUTO_COMMIT.
 */
export function resolveReviewMode(
  profileReviewMode: string | null | undefined,
  execution: { automationId: string | null; triggeredBy: string | null }
): "HOLD" | "AUTO_COMMIT" {
  const scheduled = Boolean(execution.automationId) || execution.triggeredBy === "scheduler";
  if (scheduled) return "AUTO_COMMIT";
  return profileReviewMode === "AUTO_COMMIT" ? "AUTO_COMMIT" : "HOLD";
}
