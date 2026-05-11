# ARCHITECTURE.md — Research pass for `learnhermes`

Goal of this document: before writing the course, look at OpenClaw and Hermes
Agent directly and write down what I actually found, what I could not see, and
what irreducible primitives both designs share. The course in this repo is
derived from those primitives, not from a fresh sketch.

Research was performed on **2026-05-11** against the live repos and docs.
Anything I could not directly inspect (private files, broken URLs, code I did
not fetch) is called out explicitly. I did not fill gaps from memory.

---

## 1. OpenClaw — what I inspected and what I found

**Repo:** `https://github.com/openclaw/openclaw` (MIT, released Nov 2025).
**Docs:** `https://docs.openclaw.ai/`.
**Language:** TypeScript / JavaScript, Node ≥ 22.16. Monorepo using
`pnpm-workspace.yaml`. Entry script: `openclaw.mjs`.

### 1.1 Top-level layout I confirmed via the GitHub API

```
.agents/   .crabbox.yaml   .env.example   .github/   .vscode/
AGENTS.md  CHANGELOG.md    CLAUDE.md      CONTRIBUTING.md   VISION.md
Dockerfile  LICENSE   README.md   SECURITY.md   appcast.xml
apps/   changelog/   config/   deploy/   docs/   extensions/
fly.toml   git-hooks/   openclaw.mjs   package.json
packages/   patches/   pnpm-lock.yaml   pnpm-workspace.yaml
qa/   render.yaml   scripts/   security/   skills/   src/   test/
tsconfig.*.json   tsdown.config.ts   ui/   vitest.config.ts
```

The presence of `tsconfig.core.json`, `tsconfig.extensions.json`,
`tsconfig.plugin-sdk.dts.json` confirms the project is split into a **core**
(daemon + gateway + tools), an **extensions** layer, and a **plugin SDK**.

### 1.2 Runtime model (from `docs.openclaw.ai/concepts/agent` and
`/concepts/architecture`)

- **One Gateway daemon per host.** "A single long-lived **Gateway** owns all
  messaging surfaces (WhatsApp via Baileys, Telegram via grammY, Slack,
  Discord, Signal, iMessage, WebChat)." The Gateway is started by
  `openclaw gateway` (foreground) or `openclaw daemon start` (legacy alias
  that maps to the same service control surface via launchd/systemd).
- **Single embedded agent runtime.** "one agent process per Gateway managing
  its own workspace, bootstrap files, and session storage." The runtime is
  built on what the docs call the "Pi agent core (models, tools, and prompt
  pipeline)." OpenClaw layers session management, tool wiring, and channel
  delivery on top.
- **Wire protocol.** Control-plane clients (macOS app, CLI, web UI) and
  nodes connect via WebSocket to `127.0.0.1:18789` by default. "First frame
  **must** be `connect`." Messages then follow a request/response shape:
  `{type:"req", id, method, params}` → `{type:"res", ok, payload|error}`.
- **Device pairing.** New device IDs require pairing approval; the Gateway
  issues a **device token**. "Non-local connects still require explicit
  approval."

### 1.3 Workspace model

- Workspace root: `~/.openclaw/workspace` (per docs).
- Bootstrap files live in the workspace and are injected into the agent's
  system prompt on first session turn: `AGENTS.md`, `SOUL.md`, `TOOLS.md`,
  `IDENTITY.md`, `USER.md`, and a one-shot `BOOTSTRAP.md` that is
  auto-deleted after completion.

### 1.4 Channels

- Per-channel adapters live in `packages/` and `apps/`. Confirmed bundled
  channels: WhatsApp, Telegram, Slack, Discord, Google Chat, Signal,
  iMessage, IRC, Microsoft Teams, Matrix, Feishu, LINE, Mattermost.
- Three **queue modes** for inbound: `steer` (inject mid-run after current
  tool finishes), `followup`, `collect` (queue until current turn ends,
  then start a fresh turn).

### 1.5 Skills

- Format: `SKILL.md` with YAML frontmatter. Required: `name`,
  `description`. Optional: `user-invocable`, `disable-model-invocation`,
  `command-dispatch`, `command-tool`, `homepage`, `metadata`.
- Tools and platform gating are declared inside `metadata.openclaw`:
  `requires.bins`, `requires.anyBins`, `requires.env`, `requires.config`,
  `os`, plus install specs (brew/Node/Go/download).
- Skill load precedence (highest first): workspace → project
  `.agents/skills` → personal `~/.agents/skills` → managed
  `~/.openclaw/skills` → bundled defaults → extra dirs.
- Registry: ClawHub. The CLI is `openclaw skills` for
  discover/install/update; the separate `clawhub` CLI is for publish/sync.

### 1.6 Cron / scheduling

OpenClaw documents `openclaw daemon` and gateway commands, but I was not
able to fetch a dedicated `concepts/cron` page (the URL 404'd). Cron is
listed as a feature in the project's marketing material ("scheduling" is
named in docs.openclaw.ai/concepts/agent), but I do not have a first-party
description of the schema. **I did not infer one.** The course models its
scheduler on Hermes's documented behavior (§2.5) instead.

### 1.7 Permissions / sandbox

- Per docs: "Treat third-party skills as **untrusted code**. Read them
  before enabling."
- Mechanisms confirmed in the skills doc:
  1. **Path validation** — only skill roots and files whose resolved
     realpath sits inside configured directories are accepted.
  2. **Dangerous-code scanning** — gateway-backed installs run scanners on
     installer metadata before execution.
  3. **Secret handling** — env vars and API keys are injected into the
     **host** process (not the sandbox). The docs explicitly call this a
     foot-gun.
  4. **Sandboxing gaps** — sandboxed agents need binaries installed inside
     the container separately; required host binaries do not transfer.

### 1.8 Known security caveats around skills (confirmed in docs)

- Third-party skills are untrusted by default.
- Secrets leak into prompts/logs unless skill author is careful.
- Container sandbox is opt-in; the default is host-trusted.
- Skill metadata can declare installers that download binaries — these run
  the dangerous-code scanner but the scanner is heuristic.

### 1.9 "10 files that do 80% of the work" — OpenClaw

I could list the top-level tree and read several doc pages, but I did
**not** read the contents of `src/`, `packages/`, `apps/`, or `extensions/`.
The named files below are extrapolated from directory names + the doc
descriptions. Each line says how I'd verify if I were going deeper.

1. `openclaw.mjs` — confirmed entry script. **Verify:** `head -50` to
   confirm it dispatches to gateway/cli.
2. `src/` (gateway core) — implementation of the WebSocket server,
   `connect` handshake, device pairing. **Verify:** search for
   `connect` handshake string and `18789`.
3. `packages/sdk` — confirmed in the packages listing; likely the public
   types other packages depend on.
4. `packages/plugin-sdk` — confirmed; the extension contract.
5. `packages/plugin-package-contract` — confirmed; the on-disk skill/plugin
   package schema.
6. `packages/memory-host-sdk` — confirmed; persistent memory boundary.
7. `apps/<channel-name>` — channel adapters. **Verify:** open the Telegram
   and Signal apps to see grammY and signald wiring.
8. `extensions/` — built-in extensions / tools.
9. `config/` — workspace bootstrap files (`AGENTS.md`, `SOUL.md`, etc.).
10. `skills/coding-agent/SKILL.md` — confirmed; reference shape for a
    bundled skill.

**Honest note:** I am calling out this list as named-but-unread. The
course primitives below stand even if these specific files are organized
differently inside OpenClaw.

---

## 2. Hermes Agent — what I inspected and what I found

**Repo:** `https://github.com/NousResearch/hermes-agent` (MIT, released
Feb 2026, v0.13 documented).
**Docs:** `https://hermes-agent.nousresearch.com/docs/`.
**Language:** Python 88% / TypeScript 8.9% per GitHub linguist.

### 2.1 Top-level layout I confirmed via the GitHub API

```
.dockerignore  .env.example  .envrc  .gitmodules  .mailmap  .plans/
acp_adapter/   acp_registry/  agent/  assets/    cron/    datagen-config-examples/
docker/   docs/   environments/   gateway/   hermes (bash wrapper)
hermes_bootstrap.py   hermes_constants.py   hermes_logging.py
hermes_state.py       hermes_time.py        hermes_cli/
locales/   mcp_serve.py   mini_swe_runner.py   model_tools.py
nix/   optional-skills/   packaging/   plans/   plugins/   providers/
rl_cli.py   run_agent.py   scripts/   setup-hermes.sh   skills/
tests/   tinker-atropos   toolset_distributions.py   toolsets.py
trajectory_compressor.py   tui_gateway/   tools/   ui-tui/   utils.py
uv.lock   web/   website/   batch_runner.py   cli.py
```

### 2.2 Runtime model (CLI + Gateway)

- **CLI entry:** `cli.py` (interactive CLI), `run_agent.py` (one-shot
  agent run), `hermes` bash wrapper.
- **Gateway daemon:** `gateway/` and `tui_gateway/`. The gateway is the
  persistent multi-platform process; the docs describe it as a "single
  gateway process" that fans out to "Telegram, Discord, Slack, WhatsApp,
  Signal, and CLI."
- **Session loop:** lives in `agent/`. Files I confirmed exist: `trajectory.py`,
  `curator.py`, `prompt_builder.py`, `prompt_caching.py`,
  `error_classifier.py`, plus model adapters (`anthropic_adapter.py`,
  `gemini_native_adapter.py`, and more).
- **State:** `hermes_state.py` is the SQLite-backed state file. Memory
  docs say session history is searched via "FTS5 cross-session recall with
  LLM summarization."

### 2.3 Persistent memory

- **Two markdown files in `~/.hermes/memories/`:**
  - `MEMORY.md` — agent's notes (2,200-char limit).
  - `USER.md` — user profile (1,375-char limit).
- **Tool:** the `memory` tool supports `add`, `replace` (substring match),
  and `remove`. "When memory is full, the agent consolidates or replaces
  entries to make room for new information."
- **Injection:** "At the start of every session, memory entries are loaded
  from disk and rendered into the system prompt as a frozen block." This
  is deliberately frozen-per-session so the prompt prefix stays
  cache-friendly. Changes persist immediately but only appear in the next
  session's prompt.
- **Search:** beyond the two files, a `session_search` tool queries an
  SQLite FTS5 index. External providers (Honcho, Mem0) attach via plugins.
- **Security:** memory writes run through an injection / exfiltration
  scanner before the entry is accepted.

### 2.4 Skills system

- **Disk layout:** `~/.hermes/skills/<category>/<name>/SKILL.md` (required)
  plus optional `references/`, `templates/`, `scripts/`, `assets/`. External
  read-only directories can be added via `external_dirs` in `config.yaml`.
- **Frontmatter:** `name`, `description`, `version`, optional `platforms`,
  `requires_toolsets`, `fallback_for_toolsets`, `required_environment_variables`.
- **Three-level disclosure** to save tokens:
  - L0: `skills_list()` returns metadata (~3k tokens total).
  - L1: `skill_view(name)` loads full content.
  - L2: `skill_view(name, path)` reads a reference file.
- **Self-improvement loop.** The agent uses the `skill_manage` tool
  (`create`, `patch`, `edit`, `delete`, `write_file`, `remove_file`) to
  write its own skills. It typically creates a skill after:
  - Completing a complex task (5+ tool calls).
  - Finding a working solution after errors.
  - Discovering a non-trivial workflow.
- **Trust levels** for hub-installed skills: `builtin`, `official`,
  `trusted`, `community`. `community` skills are scanned for prompt
  injection / data exfiltration / destructive commands. `--force` can
  override a non-dangerous block but **cannot** override a `dangerous`
  verdict.
- **Versioning + rollback.** Bundled skills are tracked via a
  `.bundled_manifest`. User-modified skills are protected from upstream
  overwrite. `hermes skills reset` is the escape hatch.

### 2.5 Cron / scheduled automation

- **Storage:** `~/.hermes/cron/jobs.json`. Outputs at
  `~/.hermes/cron/output/{job_id}/{timestamp}.md`.
- **Schedule grammars:** relative delays (`30m`, `2h`), intervals
  (`every 2h`), classic cron (`0 9 * * *`), ISO timestamps.
- **Natural-language → schedule:** done by a `cronjob` tool; the agent
  itself does the parsing, not a regex pipeline.
- **Execution context:** every job runs in a "fresh AIAgent session"
  with its own isolated environment. Critical: **"cron-run sessions
  cannot recursively create more cron jobs"** — to prevent scheduling
  loops.
- **Delivery:** the final response is "automatically delivered" to one or
  more configured targets (Telegram, Discord, Slack, file, email, or
  fan-out). `[SILENT]` prefix suppresses delivery.

### 2.6 Subagents / delegation

- **Tool:** `delegate_task`. Spawns "child AIAgent instances with isolated
  context, restricted toolsets, and their own terminal sessions."
- **Context isolation:** the child has "zero knowledge of the parent's
  conversation history, prior tool calls, or anything discussed before
  delegation." The only inputs are the `goal` and `context` fields the
  parent passes.
- **Tool restrictions on children:** `delegation`, `clarify`, `memory`,
  `code_execution`, `send_message` are disabled by default for leaf
  subagents.
- **Concurrency:** ThreadPoolExecutor, up to 3 concurrent children by
  default (`delegation.max_concurrent_children`), configurable.
- **Depth:** `max_spawn_depth` 1–3, default 1 (flat). At depth 3 with 3
  concurrency, the tree can fan to **27 concurrent leaf agents** — the
  docs warn about this explicitly.
- **Return:** "Only the final summary enters the parent's context."
- **Failure:** `child_timeout_seconds` (default 600). Zero-call timeouts
  produce diagnostic logs at `~/.hermes/logs/subagent-timeout-<session>-<ts>.log`.
- **Lifetime:** synchronous, in-turn. Interrupting the parent cancels all
  active children → `status="interrupted"`.

### 2.7 Channels / gateway

- Multi-platform: Telegram, Discord, Slack, WhatsApp, Signal, Matrix,
  Teams, plus 11 others (docs say 18+ built-in).
- A single gateway process handles all enabled channels.
- The gateway is the daemon — the CLI talks to the same gateway.

### 2.8 Permissions / sandbox

- Mentioned in features overview as "command approval, authorization,
  container isolation." I could not fetch a dedicated permissions page
  (the URL I guessed 404'd), so I leaned on the skills security model
  (trust tiers + scanner) and the subagent restricted toolsets to
  represent permissions in the course.

### 2.9 "10 files that do 80% of the work" — Hermes Agent

These I am much more confident about because I was able to enumerate the
top-level tree directly. Several names came from the `agent/` directory
listing returned by GitHub.

1. `cli.py` — interactive CLI entry.
2. `run_agent.py` — one-shot agent run entry.
3. `gateway/` — multi-platform daemon (entry into channels).
4. `agent/trajectory.py` — main conversation loop / turn structure.
5. `agent/curator.py` — turn-level orchestration of skills/tools/memory.
6. `hermes_state.py` — durable state, including SQLite FTS5 session
   search and memory persistence.
7. `agent/memory_manager.py` + `agent/context_engine.py` — memory write
   path and context injection.
8. `cron/` (with `~/.hermes/cron/jobs.json` on user disk) — scheduled
   automations and natural-language → schedule via the `cronjob` tool.
9. `skills/` + `agent/skill_commands.py` + `skill_preprocessing.py` —
   skill registry, three-level disclosure, autonomous skill creation via
   `skill_manage`.
10. `toolsets.py` + `tools/` + `agent/tool_guardrails.py` — tool wiring
    and per-toolset gating; used by `delegate_task` to restrict children.

**Honest note:** I confirmed each filename exists in the GitHub tree
listing for the root and the `agent/` directory. I did **not** read each
file's source. The "80% of the work" claim is a navigational hint, not a
proof.

---

## 3. Comparison: OpenClaw vs Hermes Agent vs a coding-agent course

I do not have the source for the "previous coding-agent-course" the prompt
refers to, so the third column reflects the *category* of interactive
coding agents (Claude Code, Codex CLI, OpenCode, Aider) rather than any
single repo.

| Concern | OpenClaw | Hermes Agent | Coding-agent CLI |
|---|---|---|---|
| Process model | Long-lived **Gateway** daemon + control-plane WS | Long-lived **gateway** + CLI/TUI clients | Short-lived per-invocation CLI |
| Session lifetime | Persists across user disconnect/reconnect | Persists across sessions, FTS-searched | Bound to the CLI process |
| Channels | 13+ messaging surfaces in one daemon | 18+ messaging surfaces in one daemon | One channel: stdin/stdout/IDE |
| Memory | Bootstrap files + workspace; skill-driven persistence | `MEMORY.md` + `USER.md` + FTS5 session search | None (or per-project notes) |
| Skills | `SKILL.md`, ClawHub registry, trust scanning | `SKILL.md` w/ disclosure tiers, hub trust tiers, autonomous creation | Slash commands, prompt files; usually no scanner |
| Scheduling | Cron exists (per concept page) | First-class cron, fresh session per fire, can't self-schedule | None |
| Subagents | Not the primary mental model in docs | `delegate_task`, depth+concurrency limits, restricted toolsets | Some have task agents; usually no isolation contract |
| Sandbox | Optional container; "host-trusted by default" | Tiered trust + scanner; subprocess command approval | Tool allowlist per session |
| Trigger model | **Inbound message** or **cron fire** can wake the agent | Same | **User typed a command** — agent never wakes on its own |

The third column is what makes the difference irreducible: a coding-agent
CLI is **demand-driven** (no user, no compute). OpenClaw and Hermes are
**event-driven** (a Telegram message at 3 a.m. or a cron fire at 9 a.m.
must wake an idle daemon and route correctly even though nobody is
watching).

---

## 4. Interactive coding agent vs persistent personal agent — the core
difference

An interactive coding agent answers the question: *given a user typing at
me right now, what tool calls produce the right diff?*

A persistent personal agent answers a different question: *given nobody
typing at me, what state, channels, schedule, and memory are necessary
for me to be useful next Tuesday?*

This shifts the dominant failure modes:

- The coding agent's worst day is: it wrote bad code.
- The persistent agent's worst day is: it ran a malicious skill at 4 a.m.
  while you were asleep, or it forgot a months-old preference, or it
  delivered a confidential message to the wrong channel.

That's why the OpenClaw docs lead with "Treat third-party skills as
**untrusted code**" and Hermes splits children's toolsets and depth caps
by default — both teams know the agent must be safe to leave running.

---

## 5. Irreducible primitives for an OpenClaw/Hermes-style runtime

Stripping both designs down, these are the primitives any persistent
agent runtime must implement. The 12 stages in this course map onto them
1:1.

1. **A daemon** with a documented lifecycle and a PID file so users can
   reason about whether the agent is running. (Stage 1.)
2. **Durable storage** that survives restart. Sessions, messages,
   scheduled jobs, memories, and ledger entries must all reload after a
   crash. (Stage 2.)
3. **A channel abstraction** that normalizes inbound from many surfaces
   (CLI, Telegram, Discord…) into a single event shape and routes
   outbound the same way. (Stage 3.)
4. **A job queue** with explicit states (pending/running/succeeded/
   failed/dead-letter), retries, and deterministic backoff. The daemon
   does its real work here, not in the request thread. (Stage 4.)
5. **A scheduler** that turns time itself into events. Without
   deterministic fake-clock support, scheduling is untestable. (Stage 5.)
6. **A skill registry** with on-disk format, validation, and load
   precedence. Skills are the unit of extension. (Stage 6.)
7. **A permissions / sandbox policy.** This is non-negotiable: persistent
   agents act without supervision, so risky capabilities (shell, network,
   filesystem) must be gated per-skill. (Stage 7.)
8. **Persistent memory** with bounded budget, scope, and a context
   injection contract. (Stage 8.)
9. **Subagents** with isolated session, restricted tools, capped depth,
   and failure containment. The parent must not crash when a child does.
   (Stage 9.)
10. **A self-improvement / learning loop** that proposes new skills from
    successful patterns and gates them behind validation+approval before
    they are written. (Stage 10.)
11. **A background task ledger** so detached work (cron fires, subagent
    runs, async sends) is observable and resumable. (Stage 11.)
12. **An end-to-end wiring** that proves these primitives compose into a
    runtime where a Telegram message can wake a daemon, schedule a job,
    delegate to a subagent, update memory, and notify the user back.
    (Stage 12.)

The course implements all twelve in TypeScript on Bun, with deterministic
mocks for time, channels, AI, and the filesystem so every test is
reproducible.

---

## 6. Sources I actually used (and their state on 2026-05-11)

- `github.com/openclaw/openclaw` — root listing fetched, content not read.
- `docs.openclaw.ai/concepts/agent` — fetched, quoted.
- `docs.openclaw.ai/concepts/architecture` — fetched, quoted.
- `docs.openclaw.ai/tools/skills` — fetched, quoted.
- `docs.openclaw.ai/concepts/channels` — 404 on the day I checked.
  Channel detail came from the agent-concepts page instead.
- `docs.openclaw.ai/concepts/cron` — 404. No first-party cron schema
  recovered.
- `docs.openclaw.ai/concepts/sandbox` — 404. Sandbox detail came from
  the skills page security caveats.
- `github.com/NousResearch/hermes-agent` — root listing fetched.
- `github.com/nousresearch/hermes-agent/tree/main/agent` — directory
  listing fetched.
- `hermes-agent.nousresearch.com/docs/` — fetched, quoted.
- `.../user-guide/features/memory` — fetched, quoted.
- `.../user-guide/features/skills` — fetched, quoted.
- `.../user-guide/features/cron` — fetched, quoted.
- `.../user-guide/features/delegation` — fetched, quoted.
- `.../user-guide/features/overview` — fetched, quoted.

Anything not on this list was not consulted.
