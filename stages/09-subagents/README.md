# Stage 9 — Subagents (hard)

> A subagent is a child agent the parent can hand a goal to and walk
> away from. Isolation is the whole point: the child has its own
> history, its own scratch memory, a restricted toolset, and cannot
> infinitely recurse. If it crashes, the parent reads
> `status: "failed"` and moves on.

This is the stage where the "always on, can act on its own"
architecture starts to feel different from a chat-completion loop.
Everything before it (queue, scheduler, skills, memory, permissions)
was building blocks; here we glue them into something that does work
on behalf of another agent.

---

## What you implement

`runtime/subagents/subagent.ts`.

```ts
class SubagentRunner {
  constructor(opts: SubagentRunnerOptions)
  async delegate(req: SubagentRequest): Promise<SubagentResult>
  async delegateMany(reqs: SubagentRequest[]): Promise<SubagentResult[]>
}

interface SubagentRunnerOptions {
  ai: AIClient;
  memory: Memory;
  policy: Policy;
  clock: Clock;
  logger?: Logger;
  maxDepth?: number;          // default 2; hard cap 3
  maxConcurrent?: number;     // default 3; hard cap 16
  childTimeoutMs?: number;    // default 600_000
}
```

### Lifecycle of one `delegate(req)`

1. **Depth check.** If `req.depth >= maxDepth`, return
   `{ status: "failed", summary: "depth exceeded", error: "depth" }`
   without calling the AI.

2. **Restricted toolset.** Default-forbidden tool ids:

   ```ts
   ["delegation", "memory.write", "send_message"]
   ```

   If `req.toolsets` is set, intersect against the allowed pool
   (`allTools - forbidden`). If `req.toolsets` is not set, use
   `allTools - forbidden`. The caller supplies the allowed pool via
   the `ai` mock's `tools` field; for the test the helper passes
   `["fs.read", "delegation", "memory.write"]` and expects only
   `["fs.read"]` to be forwarded.

3. **System prompt.** A short string the test can grep for:

   ```
   You are a subagent. Goal: <goal>
   <context if any>
   You CANNOT see the parent's history.
   ```

4. **AI call.** One call to `ai.complete({ system, messages: [{ role: "user", content: goal }], tools, requestId })`. The
   `requestId` is the subagent id so tests can `.script(id, …)`.

5. **Timeout.** Race against `clock.sleepUntil(start + childTimeoutMs)`.
   If timeout wins → `status: "timeout"`.

6. **Failure isolation.** If `ai.complete` throws → return
   `{ status: "failed", summary: "ai error: <msg>", error: <msg> }`.
   The parent's `delegate` call MUST NOT throw.

7. **Memory scope.** Pass the subagent id forward; any memory writes
   the child performs are scoped to
   `{ kind: "subagent", subagentId: id }`. The runner doesn't write
   on the child's behalf — but a future tool would, via this scope.

### `delegateMany(reqs)`

Fans out with concurrency capped at `min(maxConcurrent, hardCap)`.
The result array is the same length and order as the input. A failing
child does not cancel siblings.

---

## Test invariants

- Depth `>= maxDepth` is rejected without invoking AI.
- Forbidden tools are filtered out of the forwarded request.
- Subagent's `system` prompt mentions the goal and contains a phrase
  that proves history isolation ("cannot see the parent's history").
- A thrown AI call becomes `status: "failed"` — the call to
  `delegate` resolves rather than throwing.
- `delegateMany` returns results in input order, respects concurrency
  cap (never more than `maxConcurrent` AI calls in flight at once).
- Timeout: with `childTimeoutMs: 10` and an AI that never resolves,
  status comes back as `"timeout"` after the clock advances.

---

## Hints

- Generate the subagent id with `newId("sub")`. Pass it as the AI
  `requestId` so the mock can match by id.
- For concurrency: a simple semaphore (counter + queue of waiters)
  is enough. Resist the urge to import a library.
- For the timeout race: use `Promise.race([aiCall, timeoutPromise])`
  where the timeout promise sleeps via `clock.sleepUntil` and
  resolves with a sentinel. The `FakeClock` in tests fires its
  timers when you call `advance` / `advanceTo`, so the test can
  *force* the timeout by advancing time after queuing an AI that
  never resolves.
- Don't try to make the child reentrant. Each `delegate` call is a
  one-shot.

---

## Run

```
bun run stage 9
```
