/**
 * Same-origin proxy to the API (WP-A step 8, AUT-13).
 *
 * The browser talks only to the web app. Requests for /api/v1/* and /auth/*
 * arrive at the route handlers in app/api/v1 and app/auth, which pass them to
 * the API at API_INTERNAL_URL and stream the answer back. So there is one
 * origin: no allowed-origin list, no cross-port cookies, no API address in
 * the browser bundle.
 *
 * Server code only. API_INTERNAL_URL is read when a request arrives, not at build
 * time, so one build runs in any environment.
 */

/** Headers that describe one hop, not the request; never forwarded. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

/** Set by this app's middleware on the page response; not part of the API request. */
const NOT_FOR_API = new Set(["content-security-policy", "x-nonce"]);

/** The API's address as this server reaches it. Required. */
export function apiInternalUrl(): string {
  const value = process.env.API_INTERNAL_URL;
  if (!value) {
    throw new Error(
      "API_INTERNAL_URL is not set. Set it in apps/web/.env.local to the API's address " +
        "as this server reaches it, for example http://127.0.0.1:4500."
    );
  }
  return value;
}

function unavailable(message: string): Response {
  return Response.json(
    { data: null, errors: [{ code: "SERVICE_UNAVAILABLE", message }] },
    { status: 503 }
  );
}

export async function proxyToApi(request: Request): Promise<Response> {
  let base: string;
  try {
    base = apiInternalUrl();
  } catch (error) {
    console.error("[api-proxy]", error instanceof Error ? error.message : error);
    return unavailable("The service is not configured. Contact your administrator.");
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, base);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key) && !NOT_FOR_API.has(key)) headers.set(key, value);
  });
  // What the browser addressed, so the API's same-origin check sees the
  // browser's view. The API believes X-Forwarded-* only from its trusted proxy
  // addresses (TRUST_PROXY).
  //
  // X-Forwarded-For is passed on as Next.js hands it over: the client's socket
  // address when the request arrived without one, but the incoming value
  // unchanged when it arrived with one. A client talking to this server
  // directly can therefore name any address. In production a reverse proxy in
  // front of the web app must overwrite X-Forwarded-For with the client's
  // address (docs/RUNNING-WITHOUT-DOCKER.md).
  headers.set("x-forwarded-host", request.headers.get("host") ?? incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      cache: "no-store",
      // Streams the request body instead of buffering it (file imports).
      ...(hasBody ? { duplex: "half" } : {})
    } as RequestInit);
  } catch (error) {
    console.error("[api-proxy] API unreachable:", error instanceof Error ? error.message : error);
    return unavailable("The service could not be reached. Try again in a moment.");
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    // fetch has already decoded the body, so its encoding and length no longer apply.
    if (HOP_BY_HOP.has(key) || key === "content-encoding" || key === "set-cookie") return;
    responseHeaders.set(key, value);
  });
  // Each cookie separately: joining them would corrupt the session cookies.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
