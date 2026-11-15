/**
 * Every BullMQ queue and worker is built here (HC-32), with the connection
 * from db/redis.ts. No other file passes a connection to BullMQ.
 */

import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from "bullmq";
import { redisConnectionOptions } from "../db/redis.js";

export function createQueue<T = unknown>(
  name: string,
  options: Omit<QueueOptions, "connection"> = {}
): Queue<T> {
  return new Queue<T>(name, { ...options, connection: redisConnectionOptions() });
}

export function createWorker<T = unknown, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  options: Omit<WorkerOptions, "connection"> = {}
): Worker<T, R> {
  return new Worker<T, R>(name, processor, { ...options, connection: redisConnectionOptions() });
}
