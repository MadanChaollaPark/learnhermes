# Stage 3 — Message gateway

> A channel abstraction. CLI is the first real channel. Telegram,
> Discord, and email exist as mocks in the test suite. Inbound from
> any channel becomes a normalized `RuntimeEvent`. Outbound is routed
> by `ChannelId`.

This is the boundary between "the world" and "the runtime." Every
later stage assumes that when a Telegram message arrives, the rest
of the system never sees a Telegram-shaped object — it sees a
`RuntimeEvent`. Get this contract right and Stage 12 is plumbing;
get it wrong and Stage 12 is rewriting four modules.

---

## What you implement

- `runtime/gateway/gateway.ts` — the `Gateway` class.
- `runtime/gateway/channels/cli.ts` — a `CliChannel` that satisfies
  the `Channel` interface. Tests do **not** exercise real stdin; they
  use `MockChannel` instead. Your `CliChannel` only needs to compile
  and conform to the interface for now.

### Required behavior

1. **start()/stop()** call the same on every channel.
2. **subscribe** the gateway to every channel's inbound on start.
3. **ingest(env)** dedupes by `env.id` and calls `onEvent` exactly
   once per id. After dedup, build a `RuntimeEvent`:
   ```
   { kind: "message", envelope: env, source: env.channel, receivedAt: env.receivedAt }
   ```
4. **send(channel, target, body)** finds the channel by id, calls its
   `send()`, throws a clear error if the channel id is unknown.
5. Outbound to a channel whose `start()` has not been called yet
   throws. (Tests verify by stopping a channel mid-flight.)

### What "normalize" means here

Each channel is free to use its own envelope-id scheme (Telegram has
update ids, Discord has snowflakes, email has Message-Id). The
gateway treats `env.id` as **opaque** — it does not parse the id.
Dedup is exact-match on the string. Channels are responsible for
producing stable ids; the gateway is responsible for honoring them.

---

## Test invariants

- `start()` starts every channel exactly once.
- `stop()` stops every channel.
- `ingest()` with two envelopes of the same id calls `onEvent` once.
- `ingest()` with two envelopes of different ids on the same channel
  calls `onEvent` twice.
- `send("unknown", …)` throws.
- A two-channel gateway routes outbound correctly to whichever
  channel id you target.

---

## Hints

- The dedup cache can be a `Set<string>` for the course. In a real
  runtime you would bound it and persist it; here, ephemeral is fine.
- Don't double-subscribe: a channel may call `subscribe()` once. The
  gateway should call `channel.subscribe(handler)` exactly once per
  channel during `start()`.
- For the CLI channel, you can implement `start()` as a no-op that
  flips an internal flag; the tests don't read stdin. If you want
  to wire it for fun later, use `readline.createInterface(process.stdin)`.

---

## Run the tests

```
bun run stage 3
```
