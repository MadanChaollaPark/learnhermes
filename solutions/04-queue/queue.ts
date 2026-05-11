import type {
  BackoffPolicy,
  Clock,
  Job,
  JobStatus,
  Logger,
} from "@runtime/types";
import type { Store } from "@runtime/store/store";
import { newId } from "@runtime/util/ids";

export interface JobQueueOptions {
  store: Store;
  clock: Clock;
  logger?: Logger;
  backoff?: BackoffPolicy;
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

interface JobRecord extends Job, Record<string, unknown> { idempotencyKey?: string }

const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 100, factor: 2, maxMs: 30_000 };

export class JobQueue {
  private store: Store;
  private clock: Clock;
  private logger?: Logger;
  private backoff: BackoffPolicy;
  private defaultMaxAttempts: number;
  private handlers = new Map<string, JobHandler>();
  /** Track jobs we've claimed in the current tick to avoid double-run. */
  private idemIndex = new Map<string, string>(); // key → job id

  constructor(opts: JobQueueOptions) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.logger = opts.logger;
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.defaultMaxAttempts = opts.defaultMaxAttempts ?? 3;
  }

  register<P>(kind: string, handler: JobHandler<P>): void {
    this.handlers.set(kind, handler as JobHandler);
  }

  async enqueue<P>(req: EnqueueRequest<P>): Promise<Job<P>> {
    if (req.idempotencyKey) {
      const existingId = this.idemIndex.get(req.idempotencyKey)
        ?? (await this.findIdemId(req.idempotencyKey));
      if (existingId) {
        const j = await this.store.get<JobRecord>("jobs", existingId);
        if (j) return j as Job<P>;
      }
    }
    const now = this.clock.now();
    const job: JobRecord = {
      id: newId("job"),
      kind: req.kind,
      payload: req.payload as unknown,
      status: "pending",
      attempt: 0,
      maxAttempts: req.maxAttempts ?? this.defaultMaxAttempts,
      notBefore: req.notBefore ?? now,
      enqueuedAt: now,
      startedAt: null,
      completedAt: null,
      lastError: null,
      idempotencyKey: req.idempotencyKey,
    };
    await this.store.put("jobs", job);
    if (req.idempotencyKey) this.idemIndex.set(req.idempotencyKey, job.id);
    return job as Job<P>;
  }

  async get(id: string): Promise<Job | null> {
    return this.store.get<JobRecord>("jobs", id);
  }

  async listByStatus(status: JobStatus): Promise<Job[]> {
    return this.store.list<JobRecord>("jobs", (r) => r.status === status);
  }

  async tick(): Promise<{ ran: number }> {
    const now = this.clock.now();
    const due = (await this.store.list<JobRecord>("jobs"))
      .filter((j) => j.status === "pending" && j.notBefore <= now);
    let ran = 0;
    for (const j of due) {
      await this.runOne(j);
      ran++;
    }
    return { ran };
  }

  private async runOne(jobRec: JobRecord): Promise<void> {
    const handler = this.handlers.get(jobRec.kind);
    const now = this.clock.now();
    const running: JobRecord = { ...jobRec, status: "running", startedAt: now, attempt: jobRec.attempt + 1 };
    await this.store.put("jobs", running);

    if (!handler) {
      const lastError = `No handler registered for kind "${jobRec.kind}"`;
      await this.completeFail(running, lastError);
      return;
    }
    try {
      await handler(running);
      const done: JobRecord = { ...running, status: "succeeded", completedAt: this.clock.now() };
      await this.store.put("jobs", done);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.completeFail(running, msg);
    }
  }

  private async completeFail(job: JobRecord, msg: string): Promise<void> {
    if (job.attempt >= job.maxAttempts) {
      const dead: JobRecord = { ...job, status: "dead_letter", completedAt: this.clock.now(), lastError: msg };
      await this.store.put("jobs", dead);
      this.logger?.warn("queue.dead_letter", { id: job.id, kind: job.kind, msg });
      return;
    }
    const delay = Math.min(
      this.backoff.baseMs * Math.pow(this.backoff.factor, job.attempt - 1),
      this.backoff.maxMs,
    );
    const next: JobRecord = {
      ...job,
      status: "pending",
      notBefore: this.clock.now() + delay,
      startedAt: null,
      lastError: msg,
    };
    await this.store.put("jobs", next);
  }

  private async findIdemId(key: string): Promise<string | undefined> {
    const matches = await this.store.list<JobRecord>("jobs", (r) => r.idempotencyKey === key);
    return matches[0]?.id;
  }
}
