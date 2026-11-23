/**
 * Secrets readable in the registry (WP-2 acceptance: "no secret is readable
 * in the registry"). The tenant database passwords are sealed with
 * PLATFORM_ENCRYPTION_KEY; the only plain secret left would be the
 * connection string of a tenant built before WP-2 and not yet adopted, which
 * carries its password.
 */

export type RegistryRow = { slug: string; databaseUrl: string | null };

/** The tenants whose registry row holds a readable password. */
export function plaintextSecrets(rows: ReadonlyArray<RegistryRow>): string[] {
  return rows
    .filter((row) => {
      if (!row.databaseUrl) return false;
      try {
        return new URL(row.databaseUrl).password !== "";
      } catch {
        // Not a URL we can read: report it rather than assume it is safe.
        return true;
      }
    })
    .map((row) => row.slug);
}
