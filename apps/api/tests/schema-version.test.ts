/** Which tenants this release serves, by schema version (WP-2 item 3). */
import { describe, expect, it } from "vitest";
import { migrationNames } from "../src/db/migrate.js";
import {
  assertSchemaServiceable,
  releaseSchemaVersion,
  schemaState,
  TenantMaintenanceError
} from "../src/db/schema-version.js";

const names = migrationNames("tenant");

describe("tenant schema version", () => {
  it("is the newest tenant migration of this release", () => {
    expect(releaseSchemaVersion()).toBe(names.at(-1));
    expect(names[0]).toBe("0_baseline");
  });

  it("classifies a tenant's recorded version", () => {
    expect(schemaState(names.at(-1))).toBe("current");
    expect(schemaState(names[0])).toBe("behind");
    expect(schemaState("9999_from_a_newer_release")).toBe("ahead");
    expect(schemaState(null)).toBe("unmanaged");
  });

  it("refuses only a tenant behind this release, with a 503", () => {
    expect(() => assertSchemaServiceable({ slug: "acme", schemaVersion: names[0]! })).toThrow(
      TenantMaintenanceError
    );
    for (const schemaVersion of [names.at(-1)!, "9999_newer", null]) {
      expect(() => assertSchemaServiceable({ slug: "acme", schemaVersion })).not.toThrow();
    }
    const error = new TenantMaintenanceError("acme");
    expect([error.statusCode, error.code]).toEqual([503, "TENANT_MAINTENANCE"]);
  });
});
