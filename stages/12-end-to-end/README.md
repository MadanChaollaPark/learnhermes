# Stage 12 — End-to-end integration

> Glue. Channel in → Gateway → Queue → Memory + Policy + Subagent +
> AI → Channel out → Ledger completed.

You have written all the pieces. This stage proves they *compose*.
The Runtime class is small — its job is to instantiate the modules
in the right order and route events between them. The interesting
work happens in the message-job handler, which you also implement.

---

## What you implement

`runtime/runtime/runtime.ts`.

```ts
class Runtime {
  constructor(opts: RuntimeOptions)
  async start(): Promise<void>
  async stop(): Promise<void>
}

interface RuntimeOptions {
  workspace: string;
  channels: Channel[];
  ai: AIClient;
  clock: Clock;
  logger?: Logger;
  rules?: PolicyRule[];
  approve?: (req: { skill: string; action: string; scope?: string }) => Promise<boolean>;
}
```

### What `start()` does, in order

1. Construct `Store`. `open()`.
2. Construct `SkillRegistry` over `<workspace>/skills`; `load()`.
3. Construct `Policy` with `workspace`, `rules`, `approve`, the
   store.
4. Construct `Memory`, `Ledger`, `SubagentRunner`.
5. Construct `JobQueue` with the clock and a sane backoff.
6. Construct `Scheduler`.
7. Construct `Gateway`; subscribe each `channel`.
8. Register the `"message"` job handler (see below).
9. `await Promise.all(channels.map(c => c.start()))`.
10. Subscribe Gateway: every incoming `RuntimeEvent` of `kind:
    "message"` becomes a queue job:

    ```ts
    queue.enqueue({
      kind: "message",
      payload: ev.envelope,
      idempotencyKey: `${ev.envelope!.channel}:${ev.envelope!.id}`,
    });
    queue.tick();
    ```

### The `"message"` job handler

For each job (`payload: MessageEnvelope`):

1. `const led = await ledger.start("message", { envId: env.id });`
2. `const context = await memory.inject({ scope: { kind: "user" } });`
3. Call AI:
   ```ts
   ai.complete({
     system: `You are an agent. Memory:\n${context}`,
     messages: [{ role: "user", content: env.body }],
     tools: ["memory.write", "delegation", "echo"],
     requestId: led.id,
   });
   ```
4. For each tool call in the response (in order):
   - `memory.write` → `policy.require("agent", "fs.write", <workspace>)`
     then `memory.write({ content, scope: { kind: "user" } })`. On
     permission denial, record `ledger.log` and skip (don't fail
     the whole job).
   - `delegation` → `subagents.delegate({ goal: args.goal, depth: 0 })`,
     append result summary to the reply text.
   - `echo` → append `args.text` to reply text.
   - unknown tool → `ledger.log` warn, skip.
5. Send the (possibly augmented) reply text via the channel that
   delivered the message: find the matching `Channel` by id and
   call `send({ thread: env.thread, sender: env.sender }, replyText)`.
6. `ledger.transition(led.id, "completed")`.

If the AI call throws, log to the ledger and transition to
`failed` — the job's exception bubbles into the queue's normal
backoff path.

### What `stop()` does

`await Promise.all(channels.map(c => c.stop()))`, then `store.close()`.

---

## Test invariants

- Inject a message via a `MockChannel`. After `queue.tick()`, the
  channel's outbox contains the AI's text reply.
- A `memory.write` tool call inserts a `MemoryEntry` (visible to a
  subsequent `memory.search`).
- A denied `memory.write` (path outside workspace) does NOT throw —
  the job still completes and the ledger has a warn log.
- A `delegation` tool call calls the subagent runner; the
  subagent's summary appears in the outbound reply.
- Ledger has one `completed` entry per processed message.

---

## Hints

- Don't try to invent a tool-protocol. The `MockAIClient` lets you
  script tool calls directly:
  ```ts
  ai.match(/save this/, {
    text: "saved.",
    toolCalls: [{ tool: "memory.write", args: { content: "remembered" } }],
  });
  ```
- Skill execution is out of scope here — the registry is loaded but
  the test exercises tool calls, not SKILL.md execution.
- Keep `start()` synchronous-with-awaits — no background loops, no
  setIntervals. `queue.tick()` is invoked explicitly by the Gateway
  subscriber, just like Stage 5's scheduler does.

---

## Run

```
bun run stage 12
```
