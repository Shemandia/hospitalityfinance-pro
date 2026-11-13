import { describe, expect, it } from "vitest";
import { crossSiteRefusal } from "../src/middleware/csrf.js";

const session = "hfp_access_token=abc; other=1";

describe("cross-site check (AUT-13)", () => {
  it("lets a same-origin change with the session cookie through", () => {
    expect(
      crossSiteRefusal({
        method: "POST",
        cookieHeader: session,
        origin: "http://web.example:3005",
        host: "web.example:3005"
      })
    ).toBeNull();
  });

  it("refuses a change with the session cookie from another origin", () => {
    expect(
      crossSiteRefusal({
        method: "DELETE",
        cookieHeader: session,
        origin: "https://evil.example",
        host: "web.example:3005"
      })
    ).toMatch(/Cross-site/);
    // Same host name, different port, is another origin.
    expect(
      crossSiteRefusal({
        method: "PUT",
        cookieHeader: "hfp_refresh_token=r",
        origin: "http://web.example:4500",
        host: "web.example:3005"
      })
    ).toMatch(/Cross-site/);
  });

  it("refuses a change with the session cookie and no or a malformed Origin", () => {
    expect(
      crossSiteRefusal({ method: "PATCH", cookieHeader: session, origin: undefined, host: "h" })
    ).toMatch(/required/);
    expect(
      crossSiteRefusal({ method: "POST", cookieHeader: session, origin: "null", host: "h" })
    ).toMatch(/not a valid origin/);
  });

  it("does not apply to reads, or to requests without the session cookie", () => {
    expect(
      crossSiteRefusal({
        method: "GET",
        cookieHeader: session,
        origin: "https://evil.example",
        host: "h"
      })
    ).toBeNull();
    expect(
      crossSiteRefusal({ method: "POST", cookieHeader: "theme=dark", origin: undefined, host: "h" })
    ).toBeNull();
    expect(
      crossSiteRefusal({ method: "POST", cookieHeader: undefined, origin: undefined, host: "h" })
    ).toBeNull();
  });
});
