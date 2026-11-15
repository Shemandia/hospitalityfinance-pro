/**
 * Every BullMQ queue and worker is built here (HC-32), with the connection
 * from db/redis.ts. No other file passes a connection to BullMQ.
 */

import {
  DelayedError,
  Queue,
  Worker,
  type Processor,
  type QueueOptions,
  type WorkerOptions
} from "bullmq";
import { TenantMaintenanceError } from "../db/schema-version.js";
import { redisConnectionOptions } from "../db/redis.js";

export function createQueue<T = unknown>(
  name: string,
  options: Omit<QueueOptions, "connection"> = {}
): Queue<T> {
  return new Queue<T>(name, { ...options, connection: redisConnectionOptions() });
}

/** How long a job waits when its tenant is being migrated. */
export const MAINTENANCE_DELAY_MS = 120_000;

/**
 * A BullMQ worker on the shared connection.
 *
 * A job whose tenant is behind this release's schema (TenantMaintenanceError)
 * is postponed, not failed: it goes back to the queue, delayed, without using
 * one of its attempts, and runs once the migration runner has brought the
 * tenant up to date.
 */
export function createWorker<T = unknown, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  options: Omit<WorkerOptions, "connection"> = {}
): Worker<T, R> {
  const postponing: Processor<T, R> = async (job, token, signal) => {
    try {
      return await processor(job, token, signal);
    } catch (error) {
      if (!(error instanceof TenantMaintenanceError)) throw error;
      await job.moveToDelayed(Date.now() + MAINTENANCE_DELAY_MS, token);
      throw new DelayedError();
    }
  };
  return new Worker<T, R>(name, postponing, { ...options, connection: redisConnectionOptions() });
}
