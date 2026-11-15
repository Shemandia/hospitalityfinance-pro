/**
 * The web server's configuration (HC-30, HC-33).
 *
 * The only file in the web app that reads process.env, apart from
 * process.env.NODE_ENV and NEXT_RUNTIME, which Next.js sets itself and inlines
 * at build time, and scripts/next.mjs, which reads PORT before Next.js starts.
 *
 * Server code only: none of these values may reach the browser. The browser
 * needs no configuration; it calls this app's own origin, which proxies the API.
 *
 * Values are read on each call, not at import, so one build runs in any
 * environment and tests can change the environment.
 */

import { z } from "zod";

const text = () => z.string().min(1);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_INTERNAL_URL: z
    .string()
    .url()
    .optional()
    .describe("The API's address as this server reaches it: scheme, host and port."),
  HFP_PLATFORM_KEY: text()
    .optional()
    .describe("Platform machine key for the /platform pages; equals the API's PLATFORM_API_KEY."),
  PLATFORM_ADMIN_USERNAME: text().optional().describe("Platform operator user name."),
  PLATFORM_ADMIN_PASSWORD_HASH: text()
    .optional()
    .describe("Platform operator password, as scrypt:<salt-hex>:<hash-hex>.")
});

export type WebConfig = z.infer<typeof schema>;
export type WebConfigKey = keyof WebConfig;

/** Settings the web server does not start without. */
export const REQUIRED: readonly WebConfigKey[] = ["API_INTERNAL_URL"];

export class WebConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuration error:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "WebConfigError";
  }
}

/** Unset and empty are the same. */
function present(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") out[key] = value;
  }
  return out;
}

/** The parsed configuration; throws WebConfigError on an invalid value. */
export function webConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const result = schema.safeParse(present(env));
  if (!result.success) {
    throw new WebConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    );
  }
  return result.data;
}

/**
 * Every problem that should stop the server from starting: an invalid value,
 * a required setting that is missing, or half of the operator account.
 */
export function startupProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  let cfg: WebConfig;
  try {
    cfg = webConfig(env);
  } catch (error) {
    if (error instanceof WebConfigError) return error.problems;
    throw error;
  }
  const problems = REQUIRED.filter((key) => cfg[key] === undefined).map(
    (key) => `${key} is required`
  );
  if (!cfg.PLATFORM_ADMIN_USERNAME !== !cfg.PLATFORM_ADMIN_PASSWORD_HASH) {
    problems.push("PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD_HASH are set together");
  }
  return problems;
}
