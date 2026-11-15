/**
 * The one logger for the API and the workers (OPS-06).
 *
 * Fastify uses this instance, so request logs, service logs and worker logs
 * share one format: one JSON object per line. Every line carries the request
 * ID, tenant and entity of the request or job it was written in, read from the
 * request context (db/requestContext.ts) when the line is written. A line
 * written outside any request or job has none of them.
 *
 * Use `logger` directly, or `moduleLogger("name")` to tag lines with the part
 * of the system that wrote them.
 */

import pino, { type DestinationStream, type Logger } from "pino";
import { config } from "../config.js";
import { getRequestContext } from "../db/requestContext.js";
import { logSerializers } from "./log-redactor.js";

/** Context fields for the current line; a field that is not known is left out. */
export function contextFields(boundReqId: boolean): Record<string, string> {
  const ctx = getRequestContext();
  const fields: Record<string, string> = {};
  // Fastify's request logger already carries reqId; don't write it twice.
  if (ctx.requestId && !boundReqId) fields.reqId = ctx.requestId;
  if (ctx.tenantId) fields.tenantId = ctx.tenantId;
  if (ctx.entityId) fields.entityId = ctx.entityId;
  return fields;
}

/** A logger with the shared settings, writing to `destination` (default stdout). */
export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: config().LOG_LEVEL,
      serializers: { ...logSerializers, err: pino.stdSerializers.err },
      mixin(_merge, _level, instance) {
        return contextFields("reqId" in (instance as Logger).bindings());
      }
    },
    destination
  );
}

export const logger: Logger = createLogger();

/** A logger whose lines name the module that wrote them. */
export function moduleLogger(module: string): Logger {
  return logger.child({ module });
}
