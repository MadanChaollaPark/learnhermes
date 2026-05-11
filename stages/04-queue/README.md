# Stage 4 — Job queue

> The queue is where the daemon actually does work. Inbound from a
> channel becomes a job. Cron fires enqueue jobs. Subagent delegations
> are jobs internally. Get this right and the rest of the runtime is
> plumbing.

Real-world failures of persistent agents almost always show up here:
"why did this job run twice?" "why did this never retry?" "why is this
in a permanent failed state?" The course makes you answer these with
explicit states, deterministic backoff, and idempotency keys.

---

## What you implement

`runtime/queue/queue.ts` — replace stubs with a real `JobQueue`.

### State machine

```
pending → running → succeeded
                  → failed (attempt < maxAttempts) → pending  (with notBefore = now + backoff)
                  → failed (attempt = maxAttempts) → dead_letter
```

### Required surface

```ts
class JobQueue {
  constructor(opts: JobQueueOptions)
  async enqueue<P>(req: EnqueueRequest<P>): Promise<Job<P>>
  register<P>(kind: string, handler: JobHandler<P>): void
  async tick(): Promise<{ ran: number }>
  async get(id: string): Promise<Job | null>
  async listByStatus(status: JobStatus): Promise<Job[]>
}
```

### Required behavior

1. **tick()** claims every `pending` job whose `notBefore <= clock.now()`
   and runs them. Returns the count actually run.
2. **Backoff** on failure: `delay = min(baseMs * factor^(attempt-1), maxMs)`.
   The next attempt's `notBefore` is `clock.now() + delay`.
3. **Idempotency.** If `enqueue()` is called with an `idempotencyKey`
   that already maps to a job, return the existing job, do not enqueue
   a new one.
4. **Persistence.** Jobs round-trip through `Store`. A new `JobQueue`
   opened on the same workspace must recover all jobs.
5. **Unregistered handler.** If a job's `kind` has no registered
   handler at the time `tick()` runs it, the job fails with a clear
   error message and counts as an attempt (so it eventually
   dead-letters rather than retrying forever).
6. **dead_letter terminal.** Jobs in `dead_letter` never run again.

---

## Test invariants

- An enqueued job has `status = "pending"`, `attempt = 0`, `notBefore = clock.now()`.
- After one `tick()`, a successful handler's job is `succeeded`.
- After one `tick()`, a failing handler's job is back to `pending`
  with `notBefore` increased by the backoff.
- The retry does not run on the same `tick()` it was scheduled by.
- After `maxAttempts` failures, the job is `dead_letter`.
- Duplicate `idempotencyKey` returns the existing job, untouched.
- Surviving restart: `tick()` on a fresh queue runs the pending job.

---

## Hints

- Don't try to make `tick()` keep spinning on its own. Tests call it
  manually after advancing `FakeClock`. In production you would call
  it on a setInterval in `realClock`; here, it's explicit.
- A common bug: increment `attempt` *before* invoking the handler,
  not after. That way "we tried this once" is visible even if the
  handler synchronously throws.
- Keep handlers off the critical path: a job that returns instantly
  is `succeeded`, a thrown job is `failed`. Async handlers should
  reject with an Error; reject reason is recorded in `lastError`.

---

## Run

```
bun run stage 4
```
