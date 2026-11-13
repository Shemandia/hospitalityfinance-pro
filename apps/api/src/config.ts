/**
 * The API's configuration (WP-1, HC-33). The only module that reads
 * process.env.
 *
 * Every setting the API, its workers and its scripts use is declared here,
 * once, with its type, its default and a description. `config()` parses the
 * environment against this schema and returns a typed object; nothing else
 * reads process.env.
 *
 * What a process cannot run without is checked when it starts:
 *
 *   const cfg = startupConfig("api");      // exits naming every missing setting
 *
 * and a script needing particular settings asks for them by name:
 *
 *   const { DATABASE_URL } = requireConfig(["DATABASE_URL"], "db:setup:rls");
 *
 * An empty value counts as unset, so `SEED_USER_PASSWORD=` in a .env file is
 * the same as leaving the line out. apps/api/.env is read here, and never
 * overrides a variable that is already set.
 *
 * docs/ENV-VARIABLES.md lists these settings; keep the two in step.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

/**
 * apps/api/.env, when it exists, fills in variables that are not already set;
 * the real environment always wins. Loaded here so every process (API,
 * workers, scripts) sees the same settings, whatever starts it.
 */
function loadDotEnv(): void {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const text = () => z.string().min(1);
const url = () => z.string().url();
const int = () => z.coerce.number().int();
const positiveInt = () => int().min(1);
const flag = () =>
  z
    .enum(["true", "false"], { message: 'must be "true" or "false"' })
    .transform((v) => v === "true");

const schema = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development")
    .describe("development, test or production. Production enforces the production requirements."),
  PORT: int().min(1).max(65535).default(4000).describe("Port the API listens on."),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
    .describe("Log level."),
  TRUST_PROXY: text()
    .default("loopback")
    .describe(
      "Addresses whose X-Forwarded-* headers are believed (Fastify trustProxy): the web app's server."
    ),
  APP_VERSION: text().optional().describe("Version reported by /health and /version."),
  BUILD_DATE: text().optional().describe("Build date reported by /version."),
  APP_BASE_URL: url()
    .optional()
    .describe("The address users open in the browser, for links in e-mails."),

  // ── Databases ────────────────────────────────────────────────────────────
  DATABASE_URL: url()
    .optional()
    .describe(
      "A tenant database, for setup scripts and the seed; the registry fallback outside production. Never a default tenant."
    ),
  REGISTRY_DATABASE_URL: url()
    .optional()
    .describe("The tenant registry database. Required in production."),
  TENANT_POOL_MAX: positiveInt()
    .default(50)
    .describe("Most tenant database clients kept open at once."),
  TENANT_DB_HOST: text()
    .optional()
    .describe("Provisioning: host for new tenant databases (default: the registry's)."),
  TENANT_DB_PORT: text()
    .optional()
    .describe("Provisioning: port for new tenant databases (default: the registry's)."),
  TENANT_DB_USER: text()
    .optional()
    .describe("Provisioning: role that owns new tenant databases (default: the registry's)."),
  TENANT_DB_PASSWORD: text()
    .optional()
    .describe("Provisioning: that role's password (default: the registry's)."),

  // ── Redis ────────────────────────────────────────────────────────────────
  REDIS_URL: url()
    .optional()
    .describe(
      "Redis, for sessions, the access cache and job queues. Required by the API and the workers."
    ),
  ACCESS_CACHE_TTL_SECONDS: positiveInt()
    .default(300)
    .describe("Backstop lifetime of a cached access result; changes invalidate it at once."),

  // ── Sign-in and sessions ─────────────────────────────────────────────────
  JWT_SECRET: z
    .string()
    .min(32, "must be at least 32 characters")
    .optional()
    .describe("Signs session tokens. Required by the API."),
  JWT_ACCESS_EXPIRY: positiveInt().default(900).describe("Access token lifetime, seconds."),
  JWT_REFRESH_EXPIRY: positiveInt().default(604800).describe("Refresh token lifetime, seconds."),
  BCRYPT_SALT_ROUNDS: int()
    .min(10)
    .max(15)
    .default(12)
    .describe("bcrypt cost for password hashes."),
  MAX_FAILED_ATTEMPTS: positiveInt()
    .default(5)
    .describe("Failed sign-ins before the account locks."),
  LOCKOUT_DURATION_MINUTES: positiveInt()
    .default(15)
    .describe("How long a locked account stays locked."),
  COOKIE_SECURE: flag()
    .default("false")
    .describe("Mark session cookies Secure. Always on in production."),
  COOKIE_DOMAIN: text()
    .optional()
    .describe("Domain attribute for session cookies; normally unset."),
  PLATFORM_API_KEY: text()
    .optional()
    .describe("Key the platform admin uses for tenant routes. Required by the API."),

  // ── Files ────────────────────────────────────────────────────────────────
  STORAGE_BACKEND: z
    .enum(["local", "s3"])
    .default("local")
    .describe("Where Transfer Desk files live."),
  TD_LOCAL_UPLOADS_PATH: text()
    .default("./uploads")
    .describe("Local storage path; keep it outside any public web root."),
  TD_S3_BUCKET: text().optional().describe("S3 bucket for Transfer Desk files."),
  AWS_REGION: text().optional().describe("AWS region for S3."),
  AWS_S3_BUCKET: text().optional().describe("S3 bucket for generated reports."),

  // ── E-mail ───────────────────────────────────────────────────────────────
  RESEND_API_KEY: text()
    .optional()
    .describe("Resend API key; e-mail goes through Resend when set."),
  RESEND_FROM_EMAIL: text().optional().describe("Sender address for Resend."),
  AWS_SES_REGION: text().optional().describe("SES region; e-mail goes through SES when set."),
  AWS_SES_ACCESS_KEY_ID: text().optional().describe("SES access key."),
  AWS_SES_SECRET_ACCESS_KEY: text().optional().describe("SES secret key."),
  SES_FROM_EMAIL: text().optional().describe("Sender address for SES."),

  // ── Exchange rates ───────────────────────────────────────────────────────
  ECB_RATES_URL: url()
    .default("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
    .describe("Daily reference-rate feed."),

  // ── Connectors (move to per-tenant connections in WP-5) ──────────────────
  OHIP_HOSTNAME: url()
    .default("https://ohipapi.oraclecloud.com")
    .describe("Opera Cloud (OHIP) API."),
  OHIP_CLIENT_ID: text().optional().describe("Opera Cloud client id."),
  OHIP_CLIENT_SECRET: text().optional().describe("Opera Cloud client secret."),
  OHIP_ENTERPRISE_ID: text().optional().describe("Opera Cloud enterprise id."),
  MEWS_HOSTNAME: url().default("https://api.mews.com").describe("Mews API."),
  MEWS_CLIENT_TOKEN: text().optional().describe("Mews client token."),
  MEWS_ACCESS_TOKEN: text().optional().describe("Mews access token."),
  SKY_JANA_SFTP_HOST: text().optional().describe("Sky Jana SFTP host."),
  SKY_JANA_SFTP_PORT: int().min(1).max(65535).default(22).describe("Sky Jana SFTP port."),
  SKY_JANA_SFTP_USER: text().optional().describe("Sky Jana SFTP user."),
  SKY_JANA_SFTP_PASSWORD: text().optional().describe("Sky Jana SFTP password."),
  SKY_JANA_SFTP_PRIVATE_KEY: text().optional().describe("Sky Jana SFTP private key."),
  SKY_JANA_SFTP_INBOUND_PATH: text().default("/inbound").describe("Sky Jana inbound folder."),
  SKY_JANA_SFTP_OUTBOUND_PATH: text().default("/outbound").describe("Sky Jana outbound folder."),

  // ── Workers ──────────────────────────────────────────────────────────────
  WORKER_MAX_CLEAN_EXITS: positiveInt()
    .default(3)
    .describe("Clean exits in a row after which the supervisor gives up on a worker."),
  TRANSFER_DESK_TENANT_POLL_MS: positiveInt()
    .default(60_000)
    .describe("How often the Transfer Desk process checks for added or deactivated tenants."),

  // ── Development ──────────────────────────────────────────────────────────
  SEED_USER_PASSWORD: text()
    .optional()
    .describe("The demo users' password (pnpm dev:setup, db:seed)."),
  TML_ALLOW_INSECURE_SANDBOX: flag()
    .default("false")
    .describe("Tests only: run TML without the isolated sandbox. Ignored in production.")
});

export type Config = z.infer<typeof schema>;
export type ConfigKey = keyof Config;

/** The environment is missing or has an invalid setting. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuration error:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
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

function parse(env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(present(env));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    );
  }
  return result.data;
}

let cached: Config | null = null;

/** The parsed configuration. Parsed once; throws ConfigError on an invalid value. */
export function config(): Config {
  if (!cached) {
    loadDotEnv();
    cached = parse(process.env);
  }
  return cached;
}

/** Re-reads the environment. For tests that change it after start. */
export function reloadConfig(): Config {
  cached = null;
  return config();
}

type Required<K extends ConfigKey> = Config & { [P in K]-?: NonNullable<Config[P]> };

function missing(cfg: Config, keys: readonly ConfigKey[]): ConfigKey[] {
  return keys.filter((key) => cfg[key] === undefined);
}

/** The configuration with `keys` known to be set; throws ConfigError naming any that are not. */
export function requireConfig<K extends ConfigKey>(keys: readonly K[], who: string): Required<K> {
  let cfg = config();
  // A value set after the first read (tests, scripts that set their own) is picked up.
  if (missing(cfg, keys).length > 0) cfg = reloadConfig();
  const absent = missing(cfg, keys);
  if (absent.length > 0) {
    throw new ConfigError(absent.map((key) => `${key} is required by ${who}`));
  }
  return cfg as Required<K>;
}

export type ProcessKind = "api" | "workers";

/** What each long-running process needs, always and in production. */
export const STARTUP: Record<ProcessKind, { always: ConfigKey[]; production: ConfigKey[] }> = {
  api: {
    always: ["JWT_SECRET", "REDIS_URL", "APP_BASE_URL", "PLATFORM_API_KEY"],
    production: ["REGISTRY_DATABASE_URL"]
  },
  workers: {
    always: ["REDIS_URL", "APP_BASE_URL"],
    production: ["REGISTRY_DATABASE_URL"]
  }
};

/**
 * Checks everything `kind` needs. On a problem, prints every missing or
 * invalid setting by name and exits with code 1; a process never starts
 * half-configured.
 */
export function startupConfig(kind: ProcessKind): Config {
  try {
    const cfg = config();
    const needed = [
      ...STARTUP[kind].always,
      ...(cfg.NODE_ENV === "production" ? STARTUP[kind].production : [])
    ];
    const absent = missing(cfg, needed);
    if (absent.length > 0) {
      throw new ConfigError(
        absent.map(
          (key) => `${key} is required${STARTUP[kind].always.includes(key) ? "" : " in production"}`
        )
      );
    }
    return cfg;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // Before any logger exists; this is the one place the API writes to stderr directly.
    process.stderr.write(
      `${error.message}\nSet these in apps/api/.env (see docs/ENV-VARIABLES.md).\n`
    );
    process.exit(1);
  }
}

/**
 * The registry database, or undefined when it is not configured. For clients
 * built when a module loads: such a client then fails on its first query,
 * not at import.
 */
export function registryDatabaseUrlIfSet(): string | undefined {
  const cfg = config();
  return (
    cfg.REGISTRY_DATABASE_URL ?? (cfg.NODE_ENV === "production" ? undefined : cfg.DATABASE_URL)
  );
}

/** The registry database: REGISTRY_DATABASE_URL, or DATABASE_URL outside production. */
export function registryDatabaseUrl(): string {
  const cfg = config();
  const value =
    cfg.REGISTRY_DATABASE_URL ?? (cfg.NODE_ENV === "production" ? undefined : cfg.DATABASE_URL);
  if (!value) {
    throw new ConfigError([
      cfg.NODE_ENV === "production"
        ? "REGISTRY_DATABASE_URL is required in production"
        : "REGISTRY_DATABASE_URL (or DATABASE_URL) is required"
    ]);
  }
  return value;
}

/**
 * The environment for a child process: this process's own, with `overrides`
 * on top. Passing the environment on is not reading configuration.
 */
export function childProcessEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

/** The schema, for the documentation generator. */
export const configSchema = schema;

/** How docs/ENV-VARIABLES.md groups the settings. Every setting is in exactly one group. */
export const CONFIG_GROUPS: ReadonlyArray<{ title: string; keys: readonly ConfigKey[] }> = [
  {
    title: "Runtime",
    keys: [
      "NODE_ENV",
      "PORT",
      "LOG_LEVEL",
      "TRUST_PROXY",
      "APP_BASE_URL",
      "APP_VERSION",
      "BUILD_DATE"
    ]
  },
  {
    title: "Databases",
    keys: [
      "DATABASE_URL",
      "REGISTRY_DATABASE_URL",
      "TENANT_POOL_MAX",
      "TENANT_DB_HOST",
      "TENANT_DB_PORT",
      "TENANT_DB_USER",
      "TENANT_DB_PASSWORD"
    ]
  },
  { title: "Redis", keys: ["REDIS_URL", "ACCESS_CACHE_TTL_SECONDS"] },
  {
    title: "Sign-in and sessions",
    keys: [
      "JWT_SECRET",
      "JWT_ACCESS_EXPIRY",
      "JWT_REFRESH_EXPIRY",
      "BCRYPT_SALT_ROUNDS",
      "MAX_FAILED_ATTEMPTS",
      "LOCKOUT_DURATION_MINUTES",
      "COOKIE_SECURE",
      "COOKIE_DOMAIN",
      "PLATFORM_API_KEY"
    ]
  },
  {
    title: "Files",
    keys: [
      "STORAGE_BACKEND",
      "TD_LOCAL_UPLOADS_PATH",
      "TD_S3_BUCKET",
      "AWS_REGION",
      "AWS_S3_BUCKET"
    ]
  },
  {
    title: "E-mail",
    keys: [
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "AWS_SES_REGION",
      "AWS_SES_ACCESS_KEY_ID",
      "AWS_SES_SECRET_ACCESS_KEY",
      "SES_FROM_EMAIL"
    ]
  },
  { title: "Exchange rates", keys: ["ECB_RATES_URL"] },
  {
    title: "Connectors (move to per-tenant connections in WP-5)",
    keys: [
      "OHIP_HOSTNAME",
      "OHIP_CLIENT_ID",
      "OHIP_CLIENT_SECRET",
      "OHIP_ENTERPRISE_ID",
      "MEWS_HOSTNAME",
      "MEWS_CLIENT_TOKEN",
      "MEWS_ACCESS_TOKEN",
      "SKY_JANA_SFTP_HOST",
      "SKY_JANA_SFTP_PORT",
      "SKY_JANA_SFTP_USER",
      "SKY_JANA_SFTP_PASSWORD",
      "SKY_JANA_SFTP_PRIVATE_KEY",
      "SKY_JANA_SFTP_INBOUND_PATH",
      "SKY_JANA_SFTP_OUTBOUND_PATH"
    ]
  },
  { title: "Workers", keys: ["WORKER_MAX_CLEAN_EXITS", "TRANSFER_DESK_TENANT_POLL_MS"] },
  { title: "Development", keys: ["SEED_USER_PASSWORD", "TML_ALLOW_INSECURE_SANDBOX"] }
];
