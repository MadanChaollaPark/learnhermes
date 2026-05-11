# learnhermes

Build an OpenClaw / Hermes-style persistent agent runtime from scratch, in
TypeScript on Bun, one stage at a time. Each stage starts with failing
tests. You implement inside `runtime/` until the tests pass.

This is **not** another interactive coding agent (Claude Code, Codex,
OpenCode). It is the always-on **personal agent runtime** that those
tools do not try to be: a daemon that keeps state, listens on channels,
fires cron jobs, delegates to subagents, learns new skills, and runs
while you are asleep.

If you want the reasoning behind the design, read `ARCHITECTURE.md`
(research pass into the real OpenClaw and Hermes source/docs),
`DESIGN_NOTES.md` (why this is not a Claude Code clone), and
`SECURITY.md` (why always-on agents are dangerous).

---

## Workflow

1. **Read** the stage README:

   ```
   stages/01-daemon/README.md
   ```

2. **Run the stage.** First run is supposed to fail — that's the point.

   ```
   bun install
   bun run stage 1
   ```

   Equivalent forms:

   - `bun run stage 1 --watch`
   - `npm run stage -- 1`
   - `npm run test -- tests/stage-01.test.ts`

3. **Implement** inside `runtime/` until the tests are green. The stubs
   in `runtime/` are deliberately incomplete and will throw informative
   errors that tell you what's missing.

4. **Stuck?** A reference solution lives in
   `solutions/01-daemon/`. Diff it against your `runtime/` to compare.

   ```
   bun run stage solve 1
   ```

5. **Move on** to stage 2 when stage 1 is green.

---

## Stages

| # | Stage | What you build |
|---|---|---|
| 1 | `01-daemon` | A long-running runtime with start/stop/status, PID file, graceful shutdown. |
| 2 | `02-store` | A JSON-backed durable store that survives restart. Sessions, messages, jobs all reload. |
| 3 | `03-gateway` | A channel abstraction. CLI channel real, Telegram/Discord/email mocked. Normalize inbound to runtime events. |
| 4 | `04-queue` | A job queue with pending/running/succeeded/failed states, retries, deterministic backoff, dead-letter. |
| 5 | `05-scheduler` | A cron/scheduler driven by a fake clock. Jobs fire when simulated time advances, not before. |
| 6 | `06-skills` | A skill registry. `SKILL.md` with YAML frontmatter, validation, workspace-scoped override, malformed-skill rejection. |
| 7 | `07-permissions` | A permissions policy. Allow/deny per skill for fs/shell/net. Default deny for shell. Explicit approval gate. |
| 8 | `08-memory` | Persistent memory. Bounded budget. Survives restart. Context injection. |
| 9 | `09-subagents` | Subagent delegation. Isolated history, scoped memory, restricted tools, depth cap, failure isolation. **Hard.** |
| 10 | `10-learning` | A self-improving skills loop. Propose after repeated successes. Approval required. Rollback on validation failure. **Hard.** |
| 11 | `11-ledger` | A background task ledger. Status, timestamps, logs, resumability for detached work. |
| 12 | `12-end-to-end` | Wire everything: message → schedule/delegate → skill executes → memory updates → notification sent back. |

---

## Layout

```
runtime/           <-- you implement here (starts incomplete)
solutions/<NN>-…/  <-- reference solutions per stage
stages/<NN>-…/     <-- stage instructions (READMEs)
tests/             <-- failing tests for each stage
tests/mocks/       <-- FakeClock, MockChannel, MockAIClient, in-memory fs
skills/            <-- example SKILL.md files for the skill registry
run.ts             <-- the stage runner
```

---

## Constraints the course enforces

- **No real network in tests.** Channels are mocked. AI calls are mocked.
- **No real wall clock in tests.** Use `FakeClock` from `tests/mocks/clock.ts`.
- **No real subprocesses in tests.** Sandbox/permission checks are
  evaluated against a policy, not by spawning bash.
- **All persistence under `./tmp/`.** Each test gets its own workspace
  directory so test order doesn't matter.
- **Reproducible.** Tests pass identically on any machine. If they don't,
  there's a determinism bug in your implementation.

---

## What this is *not*

- Not a Claude Code clone. The course is about the runtime *around* the
  agent — daemon, channels, scheduling, memory — not about another
  ReAct loop or another tool-calling planner.
- Not a Telegram bot tutorial. Channels are deliberately abstract; the
  CLI channel is the only real one. Telegram, Discord, email exist as
  mocks so you implement against the abstraction, not against three
  HTTP APIs.
- Not a full OpenClaw / Hermes reimplementation. It is the **minimum
  runtime** that demonstrates the architectural primitives both systems
  share. See `ARCHITECTURE.md` for the source pass.

---

## Prerequisites

- Bun ≥ 1.1 (or Node ≥ 22 with `npx tsx`, but Bun is the supported path)
- A POSIX-y shell (macOS or Linux). The course has no Windows-specific
  code but PID handling is POSIX-style.

Run `bun install` once, then go.

---

## Acknowledgements

The design was derived directly from a research pass into the current
OpenClaw (`github.com/openclaw/openclaw`) and Hermes Agent
(`github.com/NousResearch/hermes-agent`) repos and docs on 2026-05-11.
See `ARCHITECTURE.md` for what was inspected and what was inferred.
