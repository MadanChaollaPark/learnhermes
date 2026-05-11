/**
 * Stage 4 — Job queue.
 *
 * pending → running → succeeded | failed | dead_letter
 *
 * Retries with exponential backoff. Deterministic via the provided
 * Clock. Idempotency via optional idempotencyKey.
 *
 * Reference solution: solutions/04-queue/queue.ts
 */

import type { BackoffPolicy, Clock, Job, JobStatus, Logger } from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";

export interface JobQueueOptions {
  store: Store;
  clock: Clock;
  logger?: Logger;
  /** Default backoff if a job doesn't specify one. */
  backoff?: BackoffPolicy;
  /** Default max attempts if a job doesn't specify. */
  defaultMaxAttempts?: number;
}

export interface EnqueueRequest<P = unknown> {
  kind: string;
  payload: P;
  maxAttempts?: number;
  notBefore?: number;
  idempotencyKey?: string;
}

export type JobHandler<P = unknown> = (job: Job<P>) => Promise<void>;

export class JobQueue {
  constructor(_opts: JobQueueOptions) {}

  async enqueue<P>(req: EnqueueRequest<P>): Promise<Job<P>> {
    void req;
    return notImplemented("04-queue", "queue/queue", "implement enqueue()");
  }

  register<P>(kind: string, handler: JobHandler<P>): void {
    void kind; void handler;
    notImplemented("04-queue", "queue/queue", "implement register()");
  }

  /** Run one cycle: claim due jobs and execute. Tests call this manually. */
  async tick(): Promise<{ ran: number }> {
    return notImplemented("04-queue", "queue/queue", "implement tick()");
  }

  async get(id: string): Promise<Job | null> {
    void id;
    return notImplemented("04-queue", "queue/queue", "implement get()");
  }

  async listByStatus(status: JobStatus): Promise<Job[]> {
    void status;
    return notImplemented("04-queue", "queue/queue", "implement listByStatus()");
  }
}
