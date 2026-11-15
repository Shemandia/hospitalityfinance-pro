/**
 * Runs once when the web server starts (next dev, next start, the standalone
 * server). A server with a missing or invalid setting exits with a message
 * naming it, instead of answering every API call with 503 (HC-30).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startupProblems } = await import("./lib/server/config");
  const problems = startupProblems();
  if (problems.length === 0) return;
  process.stderr.write(
    `Configuration error:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
      "Set these in apps/web/.env.local (see apps/web/.env.example).\n"
  );
  process.exit(1);
}
