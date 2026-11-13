/**
 * The same-origin proxy (AUT-13): what reaches the API, and what comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyToApi } from "../lib/server/api-proxy";

const upstream = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:4500");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  upstream.mockReset();
});

function browserRequest(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
) {
  return new Request(`http://hfp.example:3005${path}`, {
    ...init,
    headers: { host: "hfp.example:3005", ...(init.headers ?? {}) }
  });
}

describe("proxyToApi", () => {
  it("forwards method, path, query, body and the browser's headers to API_INTERNAL_URL", async () => {
    upstream.mockResolvedValue(new Response("{}", { status: 201 }));
    await proxyToApi(
      browserRequest("/api/v1/gl/journals?status=DRAFT", {
        method: "POST",
        body: '{"a":1}',
        headers: {
          cookie: "hfp_access_token=t",
          origin: "http://hfp.example:3005",
          "x-entity-id": "e1",
          connection: "keep-alive",
          // Set by middleware on the page response; must not reach the API.
          "x-nonce": "n",
          "content-security-policy": "default-src 'self'"
        }
      })
    );
    const [target, init] = upstream.mock.calls[0]!;
    expect(String(target)).toBe("http://127.0.0.1:4500/api/v1/gl/journals?status=DRAFT");
    expect(init.method).toBe("POST");
    const headers = init.headers as Headers;
    expect(headers.get("cookie")).toBe("hfp_access_token=t");
    expect(headers.get("origin")).toBe("http://hfp.example:3005");
    expect(headers.get("x-entity-id")).toBe("e1");
    expect(headers.get("x-forwarded-host")).toBe("hfp.example:3005");
    expect(headers.get("x-forwarded-proto")).toBe("http");
    expect(headers.has("connection")).toBe(false);
    expect(headers.has("x-nonce")).toBe(false);
    expect(headers.has("content-security-policy")).toBe(false);
    expect(headers.has("host")).toBe(false);
    expect(await new Response(init.body).text()).toBe('{"a":1}');
  });

  it("returns status, body and every cookie the API sets", async () => {
    const headers = new Headers({ "content-type": "application/json", "content-encoding": "gzip" });
    headers.append("set-cookie", "hfp_access_token=a; Path=/; HttpOnly");
    headers.append("set-cookie", "hfp_refresh_token=r; Path=/auth; HttpOnly");
    upstream.mockResolvedValue(new Response('{"data":1}', { status: 200, headers }));

    const response = await proxyToApi(
      browserRequest("/auth/login", { method: "POST", body: "{}" })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"data":1}');
    expect(response.headers.getSetCookie()).toEqual([
      "hfp_access_token=a; Path=/; HttpOnly",
      "hfp_refresh_token=r; Path=/auth; HttpOnly"
    ]);
    expect(response.headers.has("content-encoding")).toBe(false);
  });

  it("answers 503 when the API cannot be reached", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    const response = await proxyToApi(browserRequest("/api/v1/context"));
    expect(response.status).toBe(503);
    expect((await response.json()).errors[0].code).toBe("SERVICE_UNAVAILABLE");
  });

  it("answers 503 and calls nothing when API_INTERNAL_URL is not set", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    const response = await proxyToApi(browserRequest("/api/v1/context"));
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
});
