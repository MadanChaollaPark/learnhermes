# Stage 11 — Background task ledger

> Every piece of background work — a scheduled job, a subagent run,
> a learned-skill rollout — leaves a row in the ledger. Status,
> timestamps, structured logs, and a resume token. After a restart
> the daemon scans for `started`/`in_progress` rows and picks them
> up.

This is the boring stage that makes everything before it
*observable*. Without it, when the agent crashes you have no idea
what it was doing.

---

## What you implement

`runtime/ledger/ledger.ts`.

```ts
class Ledger {
  constructor(opts: LedgerOptions)
  async start(kind: string, resumeToken?: unknown): Promise<LedgerEntry>
  async log(id: string, log: Omit<LedgerLog, "at">): Promise<void>
  async transition(id: string, status: LedgerStatus): Promise<LedgerEntry>
  async get(id: string): Promise<LedgerEntry | null>
  async list(filter?: { status?: LedgerStatus; since?: number }): Promise<LedgerEntry[]>
  async resumable(): Promise<LedgerEntry[]>
}

interface LedgerOptions {
  store: Store;
  clock: Clock;
  logger?: Logger;
}
```

### `start(kind, resumeToken?)`

Persists a new `LedgerEntry`:

```ts
{
  id: newId("led"),
  kind,
  status: "started",
  startedAt: clock.now(),
  updatedAt: clock.now(),
  completedAt: null,
  logs: [],
  resumeToken,
}
```

### `log(id, { level, msg })`

Append `{ at: clock.now(), level, msg }` to the entry's `logs`,
bump `updatedAt`. If the entry is `completed` or `failed`, throw —
sealed entries are immutable.

### `transition(id, status)`

Move to `status`. The legal transitions are:

```
started      → in_progress | completed | failed
in_progress  → in_progress | completed | failed
completed    → (sealed)
failed       → (sealed)
```

If `status` is `completed` or `failed`, set `completedAt = clock.now()`.
Bumps `updatedAt`. Throws on illegal transition; throws on missing
id.

### `list({ status?, since? })`

Returns matching entries, newest first by `startedAt`. `since` is a
lower bound on `updatedAt`.

### `resumable()`

Returns entries in `started` or `in_progress`, newest first. After a
restart the daemon iterates these to decide what to retry.

---

## Test invariants

- `start` returns an entry with `status: "started"` and a generated id.
- `log` appends with `at = clock.now()`.
- `transition` enforces legal moves.
- `transition` to `completed`/`failed` sets `completedAt`.
- `log` on a sealed entry throws.
- `resumable()` returns started + in_progress entries, excludes
  completed and failed.
- A new `Ledger` instance over the same `Store` (after close/open)
  sees previous entries.

---

## Hints

- Use the existing `"ledger"` collection name.
- `Clock.now()` not `Date.now()`. Tests use `FakeClock`.
- The "sealed" check is a one-liner: `if (e.status === "completed" || e.status === "failed") throw`.
- Don't normalize logs across in-memory and persisted forms; persist
  the full entry on every mutation. Simple wins.

---

## Run

```
bun run stage 11
```
