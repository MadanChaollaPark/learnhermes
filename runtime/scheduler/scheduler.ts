/**
 * Stage 5 — Scheduler / cron.
 *
 * Stores ScheduledJob entries. On tick(), enqueues every entry whose
 * nextFireAt <= now(). Updates nextFireAt based on schedule shape.
 *
 * Natural-language → schedule is intentionally mocked at the boundary
 * (parseSchedule). The scheduler itself only deals with structured
 * Schedule values.
 *
 * Reference solution: solutions/05-scheduler/scheduler.ts
 */

import type { Clock, Logger, Schedule, ScheduledJob } from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";
import type { JobQueue } from "../queue/queue";

export interface SchedulerOptions {
  store: Store;
  queue: JobQueue;
  clock: Clock;
  logger?: Logger;
}

export interface ScheduleRequest {
  schedule: Schedule;
  jobKind: string;
  jobPayload: unknown;
  maxFires?: number | null;
}

export class Scheduler {
  constructor(_opts: SchedulerOptions) {}

  async schedule(req: ScheduleRequest): Promise<ScheduledJob> {
    void req;
    return notImplemented("05-scheduler", "scheduler/scheduler", "implement schedule()");
  }

  async tick(): Promise<{ fired: number }> {
    return notImplemented("05-scheduler", "scheduler/scheduler", "implement tick()");
  }

  async cancel(id: string): Promise<boolean> {
    void id;
    return notImplemented("05-scheduler", "scheduler/scheduler", "implement cancel()");
  }

  async list(): Promise<ScheduledJob[]> {
    return notImplemented("05-scheduler", "scheduler/scheduler", "implement list()");
  }
}

/**
 * Compute the next fire time for a schedule.
 * `lastFiredAt = null` means "this is the first computation."
 *
 * Returns null if the schedule has run out (e.g. a one-shot that
 * already fired).
 */
export function nextFireAt(schedule: Schedule, lastFiredAt: number | null, now: number): number | null {
  void schedule; void lastFiredAt; void now;
  return notImplemented("05-scheduler", "scheduler/scheduler", "implement nextFireAt()");
}
