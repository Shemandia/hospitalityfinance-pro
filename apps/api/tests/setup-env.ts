/**
 * Runs before every test file (vitest.config.ts, setupFiles).
 *
 * Tests never reach the real tenant registry: REGISTRY_DATABASE_URL (which a
 * developer's .env points at the registry their running stack uses) is
 * replaced by TEST_REGISTRY_DATABASE_URL, or removed when there is none.
 * Found 23 November 2026: tests that build the whole app read the real
 * registry through it.
 */
if (process.env.TEST_REGISTRY_DATABASE_URL) {
  process.env.REGISTRY_DATABASE_URL = process.env.TEST_REGISTRY_DATABASE_URL;
} else {
  delete process.env.REGISTRY_DATABASE_URL;
}
