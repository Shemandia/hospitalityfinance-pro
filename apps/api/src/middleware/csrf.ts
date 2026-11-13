/**
 * Cross-site request protection (WP-A step 8, AUT-13).
 *
 * The browser reaches the API only through the web app's same-origin proxy,
 * so there is no list of allowed origins to configure. The rule:
 *
 *   A state-changing request that carries the session cookie must come from
 *   the page's own origin: its Origin header must name the host the request
 *   was addressed to (Host, or X-Forwarded-Host from a trusted proxy).
 *
 * Requests without the session cookie (server-to-server calls with the
 * platform key, bearer-token clients, webhooks) cannot be forged by another
 * site, because the browser adds nothing that authenticates them.
 */

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SESSION_COOKIE = /(?:^|;\s*)hfp_(?:access|refresh)_token=/;

export type CsrfInput = {
  method: string;
  cookieHeader: string | undefined;
  origin: string | undefined;
  /** host[:port] the request was addressed to, as the browser saw it. */
  host: string | undefined;
};

/** Returns why the request is refused, or null when it may proceed. */
export function crossSiteRefusal(input: CsrfInput): string | null {
  if (!MUTATIONS.has(input.method.toUpperCase())) return null;
  if (!input.cookieHeader || !SESSION_COOKIE.test(input.cookieHeader)) return null;
  if (!input.origin) return "Origin header is required for state-changing requests.";
  let originHost: string;
  try {
    originHost = new URL(input.origin).host;
  } catch {
    return "Origin header is not a valid origin.";
  }
  if (!input.host || originHost.toLowerCase() !== input.host.toLowerCase()) {
    return "Cross-site request refused.";
  }
  return null;
}
