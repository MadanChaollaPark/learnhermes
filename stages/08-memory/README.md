# Stage 8 — Persistent memory

> The agent's notes to its future self. Survives restart. Bounded.
> Frozen at session start so it cannot grow without limit in the
> middle of a conversation.

This is the smallest interesting "always on" feature an agent has:
the ability to remember something between conversations. Hermes
keeps it in two files (`MEMORY.md` and `USER.md`); we keep it in the
store, keyed by scope.

---

## What you implement

`runtime/memory/memory.ts`.

```ts
class Memory {
  constructor(opts: MemoryOptions)
  async write(entry: { content: string; tags?: string[]; scope: MemoryScope }):
    Promise<MemoryEntry>
  async read(id: string): Promise<MemoryEntry | null>
  async search(query: MemoryQuery): Promise<MemoryEntry[]>
  async delete(id: string): Promise<boolean>
  async inject(query: MemoryQuery): Promise<string>
}

interface MemoryOptions {
  store: Store;
  logger?: Logger;
  userBudget?: number;       // default 2200 chars
  injectionBudget?: number;  // default 1000 chars
}
```

### Behavior

- `write` persists a `MemoryEntry` into `store.put("memories", …)`.
  - Generate an id with `newId("mem")`.
  - `createdAt = updatedAt = Date.now()`.
  - If `scope.kind === "user"` and total user-scope `content` length
    would exceed `userBudget`: evict oldest user-scope memories
    (smallest `updatedAt`) until the new total fits. Eviction
    `delete`s them, and a `memory.evicted` log line is emitted.
- `read(id)` returns the entry or `null`.
- `search(query)` returns matching entries, newest first:
  - filter by `scope` (deep equal on the scope object),
  - filter by every tag in `tags` (all must be present),
  - filter by `search` substring (case-insensitive) against
    `content` or any tag,
  - apply `limit` if set.
- `delete(id)` deletes; returns whether anything was removed.
- `inject(query)` runs `search` and concatenates entries, newest
  first, separated by `\n---\n`, stopping once the running length
  exceeds `injectionBudget`. Returns `""` if no matches.

### Why a budget

Without one, the agent eventually OOMs its own prompt. Hermes hard-
caps `MEMORY.md` at ~2200 characters and forces summarization on
overflow. We do the simpler thing — drop the oldest — because the
focus here is the *budget mechanism*, not summarization. Stage 10
shows where summarization belongs (skills, not the runtime).

### Frozen at session start

The runtime injects memory once per session and reuses the result;
it does **not** re-inject mid-turn. The `inject(query)` method
itself is pure read — the "freezing" is a caller convention. The
test for this just checks that two calls with the same query
produce the same string if nothing was written in between.

---

## Test invariants

- `write` → `read` round-trips.
- `search` filters by scope, tags, and substring.
- User-scope writes that exceed `userBudget` evict the oldest until
  they fit; non-user scopes are unbounded.
- `inject` concatenates newest-first, stops at `injectionBudget`.
- After `Store.close()` and re-`open()`, memories are still there.

---

## Hints

- `Store.list("memories")` is the only read path you need. Use a
  filter callback or filter in JS.
- Deep equality on `MemoryScope` is just `JSON.stringify(a) ===
  JSON.stringify(b)` for the shapes we use.
- Don't try to be clever about ranking. "Newest first" is the entire
  ordering policy.
- Char-count, not token-count. Tokens are an LLM detail; the budget
  abstraction stays runtime-only.

---

## Run

```
bun run stage 8
```
