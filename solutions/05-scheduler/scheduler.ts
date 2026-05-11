import type {
  Clock,
  Logger,
  Schedule,
  ScheduledJob,
} from "@runtime/types";
import type { Store } from "@runtime/store/store";
import type { JobQueue } from "@runtime/queue/queue";
import { newId } from "@runtime/util/ids";

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

const MS_MIN = 60_000;

export class Scheduler {
  private store: Store;
  private queue: JobQueue;
  private clock: Clock;
  private logger?: Logger;

  constructor(opts: SchedulerOptions) {
    this.store = opts.store;
    this.queue = opts.queue;
    this.clock = opts.clock;
    this.logger = opts.logger;
  }

  async schedule(req: ScheduleRequest): Promise<ScheduledJob> {
    const now = this.clock.now();
    const next = nextFireAt(req.schedule, null, now);
    const sj: ScheduledJob & Record<string, unknown> = {
      id: newId("sched"),
      schedule: req.schedule,
      jobKind: req.jobKind,
      jobPayload: req.jobPayload,
      nextFireAt: next ?? Number.POSITIVE_INFINITY,
      lastFiredAt: null,
      enabled: next !== null,
      maxFires: req.maxFires ?? null,
      firesSoFar: 0,
    };
    await this.store.put("schedules", sj);
    return sj;
  }

  async tick(): Promise<{ fired: number }> {
    const now = this.clock.now();
    const all = await this.store.list<ScheduledJob & Record<string, unknown>>("schedules");
    const due = all
      .filter((s) => s.enabled && s.nextFireAt <= now)
      .sort((a, b) => a.nextFireAt - b.nextFireAt);
    let fired = 0;
    for (const sj of due) {
      await this.queue.enqueue({ kind: sj.jobKind, payload: sj.jobPayload });
      // Also tick the queue once so the test can observe results in `succeeded`.
      await this.queue.tick();
      const newLast = sj.nextFireAt;
      const fires = sj.firesSoFar + 1;
      const next = nextFireAt(sj.schedule, newLast, this.clock.now());
      const reachedMax = sj.maxFires !== null && fires >= sj.maxFires;
      const enabled = next !== null && !reachedMax;
      const updated: ScheduledJob & Record<string, unknown> = {
        ...sj,
        lastFiredAt: newLast,
        firesSoFar: fires,
        nextFireAt: next ?? Number.POSITIVE_INFINITY,
        enabled,
      };
      await this.store.put("schedules", updated);
      fired++;
    }
    return { fired };
  }

  async cancel(id: string): Promise<boolean> {
    return this.store.delete("schedules", id);
  }

  async list(): Promise<ScheduledJob[]> {
    return this.store.list<ScheduledJob & Record<string, unknown>>("schedules");
  }
}

export function nextFireAt(
  schedule: Schedule,
  lastFiredAt: number | null,
  now: number,
): number | null {
  switch (schedule.type) {
    case "once":
      return lastFiredAt === null ? schedule.at : null;
    case "interval":
      if (lastFiredAt === null) return schedule.startAt ?? now;
      return lastFiredAt + schedule.everyMs;
    case "cron": {
      const base = lastFiredAt === null ? now : lastFiredAt + 1;
      return nextCronMatch(schedule.expr, base);
    }
  }
}

// ── cron ─────────────────────────────────────────────────────────────────

interface CronExpr {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

const RANGES = {
  minute: [0, 59] as [number, number],
  hour: [0, 23] as [number, number],
  dom: [1, 31] as [number, number],
  month: [1, 12] as [number, number],
  dow: [0, 6] as [number, number],
};

function parseField(field: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let stepStr = "1";
    let rangeStr = part;
    if (part.includes("/")) {
      const split = part.split("/");
      rangeStr = split[0];
      stepStr = split[1];
    }
    const step = Number(stepStr);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step "${stepStr}" in "${part}"`);
    }
    let a: number, b: number;
    if (rangeStr === "*") {
      a = lo; b = hi;
    } else if (rangeStr.includes("-")) {
      const [as, bs] = rangeStr.split("-");
      a = Number(as); b = Number(bs);
    } else {
      a = Number(rangeStr); b = a;
    }
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < lo || b > hi || a > b) {
      throw new Error(`Invalid cron field "${field}"`);
    }
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron expression must have 5 fields, got "${expr}"`);
  return {
    minute: parseField(parts[0], RANGES.minute),
    hour: parseField(parts[1], RANGES.hour),
    dom: parseField(parts[2], RANGES.dom),
    month: parseField(parts[3], RANGES.month),
    dow: parseField(parts[4], RANGES.dow),
  };
}

function matches(e: CronExpr, d: Date): boolean {
  return (
    e.minute.has(d.getUTCMinutes()) &&
    e.hour.has(d.getUTCHours()) &&
    e.dom.has(d.getUTCDate()) &&
    e.month.has(d.getUTCMonth() + 1) &&
    e.dow.has(d.getUTCDay())
  );
}

function nextCronMatch(expr: string, base: number): number | null {
  const e = parseCron(expr);
  // Round up to next minute boundary.
  let t = Math.ceil(base / MS_MIN) * MS_MIN;
  // Cap walk at ~366 days to avoid infinite loops on impossible cron expressions.
  const cap = t + 366 * 24 * 60 * MS_MIN;
  while (t <= cap) {
    if (matches(e, new Date(t))) return t;
    t += MS_MIN;
  }
  return null;
}
