# Stage 2 — Durable session store

> Persist sessions, messages, jobs, memories, and ledger entries to disk.
> Survive process restart. Be atomic enough that `kill -9` mid-write does
> not corrupt the store.

This is the unglamorous stage that every later stage relies on. Get it
wrong and every other module's "survives restart" test fails for a
reason that isn't actually that module's fault.

---

## What you implement

`runtime/store/store.ts` — replace the `notImplemented(...)` calls with
a working `Store` class.

### Required surface

```ts
class Store {
  constructor(opts: StoreOptions)
  async open(): Promise<void>
  async close(): Promise<void>
  async put<T>(collection, record): Promise<T>
  async get<T>(collection, id): Promise<T | null>
  async list<T>(collection, filter?): Promise<T[]>
  async delete(collection, id): Promise<boolean>
}
```

### On-disk layout

- One JSON file per collection, at `<workspace>/store/<collection>.json`.
- Each file is a JSON object keyed by record `id`:
  ```json
  { "<id>": { "id": "<id>", ...rest }, ... }
  ```
- Files are pretty-printed (`JSON.stringify(obj, null, 2)`) so a
  human can read them — these are state files, not high-throughput.

### Atomicity

Every write must use the **write-temp-then-rename** pattern:

1. Stringify the new value.
2. Write it to `<file>.<tmpid>.tmp`.
3. `fs.fsync` the temp file (best effort).
4. `fs.rename` the temp file over the real file.

`fs.rename` is atomic on POSIX. After `kill -9` you are guaranteed
that either the old content or the new content is on disk, never a
half-written file.

### Concurrency

`put`, `delete`, and `list` may be called concurrently. They must
appear to happen in some serial order per-collection — readers never
see a half-written collection, writers never lose each other's data.

The simplest way: a per-collection write queue. (A single shared
mutex also works.)

---

## Test invariants

- After `put`, the record is `get`-able in the same instance and after
  a `close()` + new `Store(...).open()`.
- No `.tmp` file is left behind under `<workspace>/store/` after a
  successful write.
- 50 concurrent `put`s of distinct records all land on disk.
- `delete` returns `true` on existing record, `false` on missing.
- `list` with no filter returns every record; with a filter it returns
  only the matches.
- Collections are independent — writing to `messages` does not
  perturb `jobs`.

---

## Hints

- You can hold an in-memory `Map` per collection for fast reads.
  Reload it on `open()`.
- `fs.promises.rename` is your friend.
- For the per-collection queue you can use a chained promise:
  ```
  this.queues[c] = (this.queues[c] ?? Promise.resolve()).then(...)
  ```
- Don't worry about file locking across processes. The course is
  single-daemon by design (Stage 1 enforces that).

---

## Run the tests

```
bun run stage 2
```
