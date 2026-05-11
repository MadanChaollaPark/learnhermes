# DESIGN_NOTES.md — why `learnhermes` is not a Claude Code clone

This file exists because the prompt asked: *what makes this course
different from a coding-agent course?* The honest answer is that a
coding-agent course teaches the **planner**, and this course teaches
the **runtime around the planner**.

If you already built an interactive coding agent, most of the LLM
loop will feel familiar. Almost none of the rest will. The deltas are
in this document.

---

## 1. The trigger model is different

| | Interactive coding agent | Persistent personal agent |
|---|---|---|
| Who starts a turn? | The user typed a prompt | A channel adapter received a message, **or** the scheduler fired a job, **or** a parent agent delegated, **or** a hook detected something |
| Who is on screen? | A human, watching | Nobody. The user is asleep, away, or in another channel. |
| What does idle mean? | The CLI is not running | The daemon is running but doing nothing. There is still work-in-progress in the queue. |
| What's the success criterion of "ready"? | "Show me a prompt" | "PID file is present, channels are connected, scheduler is ticking, queue is draining." |

The single biggest consequence: **you cannot defer behavior to the user
being present**. The runtime has to decide what to do, log it, deliver
notifications, and continue even when nothing is watching.

---

## 2. State lives on disk, not in the process

Claude Code / Codex / Aider all happily store conversation state in
the CLI process — when the process exits, the state is gone (or
snapshotted to disk and reloaded on the next CLI invocation). For
a persistent agent that's wrong on three counts:

- **Multiple producers** can write at once: the gateway is receiving a
  Telegram message while cron is firing a 9 a.m. brief.
- **Restart is normal**, not exceptional: the daemon may be supervised
  by launchd/systemd and restarted on any crash.
- **Cross-session search** is the point: Hermes ships an FTS5 index
  over historical sessions because the user genuinely wants to recall
  what the agent said three weeks ago.

That is why Stage 2 (durable store) comes immediately after Stage 1
(daemon skeleton), before anything interesting like skills. The order
matters: most bugs in real persistent agents come from "I forgot the
process can die between these two operations."

---

## 3. Channels are not interchangeable

In Claude Code the channel is stdin/stdout. In OpenClaw and Hermes the
channels are Telegram, Discord, Slack, WhatsApp, Signal, iMessage,
Matrix, plus a CLI. They are **observably different**:

- Telegram lets you edit messages after the fact.
- Discord has guild/channel/thread hierarchy.
- WhatsApp / Signal have end-to-end encrypted sessions.
- Email is asynchronous and may arrive out of order.
- CLI is synchronous and lossless.

Stage 3 introduces a **normalized envelope shape** that all channels
must produce. Without this, "send the result back to the user" becomes
13 if-statements. With it, the rest of the runtime never sees a
Telegram-shaped object — it sees an envelope and it sees a channel id.

---

## 4. The job queue is the runtime, not an optimization

In a CLI coding agent there is no queue: the user typed something, the
agent does something, returns. In a persistent runtime, the queue is
**the** runtime. Inbound from a channel becomes an enqueued job. Cron
fires enqueue a job. Subagent delegation is, internally, the parent
enqueuing a job for the child and waiting on it. End-to-end (Stage 12)
is just: which jobs run in which order with which side-effects.

This is why Stage 4 makes you implement explicit job states with
deterministic backoff. If your retry logic is "sleep 1 second and try
again," you can't test it. If it advances a fake clock, you can.

---

## 5. Memory is two systems, not one

Hermes draws a sharp line and we follow it:

- **MEMORY.md / USER.md** are the bounded, curated, prompt-injected
  memory. Frozen at session start so the prompt prefix stays
  cache-friendly. Hand-edited by the agent via a `memory` tool.
- **Session search** is the unbounded, append-only history. FTS5 in
  Hermes; a simple inverted index in this course. Queried *on demand*
  via a tool, never injected up-front.

A coding agent rarely needs this split because each session is short
and self-contained. A persistent agent always does, because the prompt
budget is bounded and the history is not.

Stage 8 enforces the budget and tests that **only relevant memories**
get injected. If your implementation always returns everything, the
test fails because the budget overflows.

---

## 6. Subagents have a real isolation contract

Hermes calls these "delegations." The isolation matters:

- Child has zero knowledge of parent history.
- Child's toolset is **restricted**, not "all parent tools."
- `memory`, `delegation`, `send_message` are disabled on leaf children
  by default.
- Depth is capped at a configurable max (1–3 in Hermes; default flat).
- Children's failures are isolated — the parent continues.

A naïve subagent in a coding-agent CLI is just "spawn another agent
and stream its tool calls back." A subagent in a persistent runtime
has to behave like a deny-by-default process: you decide explicitly
what context, what tools, what permissions it inherits. Stage 9 makes
you wire this — and the test suite tries to leak parent state into
the child, depth-overflow, fail the child, and continue.

---

## 7. Self-improving skills are *gated*, not automatic

Hermes's `skill_manage` tool lets the agent write new skills. The
naïve implementation is "if a task succeeds, write a skill." The
correct implementation is:

1. Observe that the same kind of task has succeeded *N* times.
2. Generate a proposed `SKILL.md`.
3. Run validation (Stage 6's validator).
4. Run a safety scan (no shell-in-name, no path traversal, no
   destructive verbs in description).
5. Require approval — either auto-approve in trusted mode, or surface
   to the user via the channel they registered.
6. Write to disk under a new version.
7. If the next *K* uses fail, roll back the version.

Stage 10 is the only stage in the course where the user can plausibly
generate destructive code by accident — so it's the only stage with
both a validator gate and an approval gate. The tests force you to
build both.

---

## 8. Sandboxing is opt-in everywhere; default is "deny risky"

Both OpenClaw and Hermes ship trust models, not perfect sandboxes.
OpenClaw's docs are explicit: "Treat third-party skills as untrusted
code. Read them before enabling." The course follows the same model:

- Per-skill `allow` / `deny` lists for `fs.read`, `fs.write`, `shell`,
  `net.fetch`.
- Default `deny` for `shell`.
- An **approval gate** — a permission tagged `prompt` triggers a
  prompt-channel callback. In tests the callback is auto-approve or
  auto-deny.

Stage 7 builds this. Every later stage layers on top: skills declare
their permissions, scheduler-fired jobs run under the declaring
skill's policy, subagents inherit a *more* restrictive subset of the
parent's permissions.

---

## 9. Determinism is a feature, not a side effect

A persistent agent that is non-deterministic in test mode is
untestable. The course enforces:

- All clocks go through `FakeClock`. Time never advances except via
  `clock.advance(ms)`.
- All AI calls go through `MockAIClient`. The mock returns scripted
  responses indexed by a request hash.
- All channels in tests are `MockChannel`. They expose `.inject()` to
  push inbound and `.outbox` to assert outbound.
- All filesystem in tests is a temp dir under `./tmp/test-<n>/`,
  removed before each test.

This is the single biggest practical lesson from this course: if you
want to ship a 24/7 agent, you have to write code that you can stop
the clock on.

---

## 10. What this course leaves out (on purpose)

- **Real channel adapters.** Telegram, Discord, etc. are mocks. Writing
  a grammY adapter is mechanical and would dwarf the runtime.
- **Multi-host gateway.** OpenClaw supports macOS + iOS + Android nodes
  attaching to the gateway. We have one host.
- **A real LLM.** The mock client returns canned outputs keyed by a
  hash of the prompt. The course is about the runtime, not the model.
- **A trust-tier registry.** Hermes has `builtin`/`official`/`trusted`/
  `community` trust levels with online scanning. We have `allow`/`deny`/
  `prompt` and a local validator.
- **Browser automation, voice, vision.** Out of scope.

These are *real* parts of real persistent agents; they're omitted so
the course is finishable in an evening per stage instead of a quarter.
