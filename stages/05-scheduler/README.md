# Stage 5 — Scheduler / cron

> Turn *time* into events. Without deterministic fake-clock support,
> scheduling is untestable — and an untestable scheduler is the
> ultimate "well it works on my machine."

Hermes calls this "Scheduled Tasks (Cron)" and explicitly carves out
that cron-fired sessions cannot recursively schedule more cron jobs.
We will replicate that property at Stage 12; for now we focus on the
mechanics.

---

## What you implement

`runtime/scheduler/scheduler.ts`. Two surfaces:

```ts
function nextFireAt(schedule, lastFiredAt: number | null, now: number): number | null

class Scheduler {
  async schedule(req): Promise<ScheduledJob>
  async tick(): Promise<{ fired: number }>
  async cancel(id): Promise<boolean>
  async list(): Promise<ScheduledJob[]>
}
```

### Schedule shapes

```ts
type Schedule =
  | { type: "once"; at: number }
  | { type: "interval"; everyMs: number; startAt?: number }
  | { type: "cron"; expr: string }
```

### `nextFireAt` contract

| Case | Returns |
|---|---|
| `once`, `lastFiredAt === null` | `at` (even if `at < now` — fires immediately on next tick) |
| `once`, `lastFiredAt !== null` | `null` (already fired) |
| `interval`, `lastFiredAt === null` | `startAt ?? now` |
| `interval`, `lastFiredAt !== null` | `lastFiredAt + everyMs` |
| `cron`, `lastFiredAt === null` | smallest minute-aligned `T >= now` matching `expr` |
| `cron`, `lastFiredAt !== null` | smallest minute-aligned `T > lastFiredAt` matching `expr` |

Cron expression: classic 5 fields — `minute hour day-of-month month day-of-week`.
Supported syntax per field: `*`, `n`, `a-b`, `a,b`, `*/n`. That's enough for
the course; richer parsers are an exercise.

### Scheduler.tick()

1. Load all enabled `ScheduledJob` records.
2. For each whose `nextFireAt <= clock.now()`:
   - Enqueue a job via `JobQueue.enqueue({ kind: jobKind, payload: jobPayload })`.
   - Set `lastFiredAt = nextFireAt`, `firesSoFar += 1`.
   - Recompute `nextFireAt`. If `null` OR `firesSoFar >= maxFires`, mark
     `enabled = false`.
   - Persist.
3. Return `{ fired }`.

`tick()` MUST fire all currently-due jobs in `nextFireAt` ascending order.

---

## Test invariants

- A `once { at: T }` schedule fires on the first tick after `now >= T`,
  never before.
- An `interval { everyMs: 300 }` fires at `now, now+300, now+600…`.
- A cron `*/5 * * * *` starting at `now=0` fires at
  `0, 300_000, 600_000, …` (every 5 minutes).
- A schedule with `maxFires: 2` stops firing after 2 fires.
- `cancel(id)` removes the schedule.
- Two due schedules fire in `nextFireAt` order.

---

## Hints

- Build a small `parseCron(expr)` that returns `Set<number>` per field,
  plus a `matches(date)` predicate that checks all five sets.
- Use `Date.UTC` rather than `new Date` to avoid local-time gotchas
  during the course. (Real systems usually run cron in a configured TZ;
  out of scope here.)
- To find "smallest minute-aligned T >= base matching expr": start at
  the minute boundary `ceil(base / 60_000) * 60_000` and walk forward
  one minute at a time. Cap at ~1 year of walks to bail on impossible
  expressions like `0 0 31 2 *`.

---

## Run

```
bun run stage 5
```
