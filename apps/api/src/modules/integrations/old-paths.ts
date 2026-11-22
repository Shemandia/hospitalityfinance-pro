/**
 * Transfer Desk was renamed Integrations on 21 November 2026 (import plan,
 * section 6b). For one release the old API paths answer with a permanent
 * redirect (308: the method and body are kept) to the new ones; then this
 * file is deleted.
 *
 *   /api/v1/integration/transfer-desk/*  ->  /api/v1/integrations/*
 *   /api/v1/transfer-desk/profiles...    ->  /api/v1/integrations/profiles...
 *   /api/v1/transfer-desk/*              ->  /api/v1/integrations/builder/*
 *   /api/v1/integrations/builder/profiles...  ->  /api/v1/integrations/profiles...
 *   /api/v1/integration/*                ->  /api/v1/integrations/*
 *
 * The profile builder's profile routes were merged into the one profiles
 * API (import plan step 10), hence the builder/profiles entry.
 *
 * The redirect itself reveals nothing; the new path checks access as usual.
 */
import type { FastifyInstance } from "fastify";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const OLD_INTEGRATION_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["/api/v1/integration/transfer-desk/", "/api/v1/integrations/"],
  ["/api/v1/transfer-desk/profiles", "/api/v1/integrations/profiles"],
  ["/api/v1/transfer-desk/", "/api/v1/integrations/builder/"],
  ["/api/v1/integrations/builder/profiles", "/api/v1/integrations/profiles"],
  ["/api/v1/integration/", "/api/v1/integrations/"]
];

export function newIntegrationPath(url: string): string | null {
  for (const [from, to] of OLD_INTEGRATION_PATHS) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return null;
}

export async function registerOldIntegrationPaths(app: FastifyInstance): Promise<void> {
  for (const [from] of OLD_INTEGRATION_PATHS) {
    // A prefix without a trailing slash is a path of its own too (a list).
    const urls = from.endsWith("/") ? [`${from}*`] : [from, `${from}/*`];
    for (const url of urls) {
      app.route({
        method: [...METHODS],
        url,
        config: { access: "public" },
        handler: async (request, reply) => {
          const target = newIntegrationPath(request.url);
          if (!target) return reply.code(404).send();
          return reply.code(308).header("location", target).send();
        }
      });
    }
  }
}
