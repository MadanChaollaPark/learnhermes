# Stage 1 — Daemon skeleton

> Build a long-running runtime process with `start` / `stop` / `status`,
> a PID file, and graceful shutdown.

Everything else in the course depends on this. A persistent agent's
identity *is* the daemon: it owns the workspace, supervises channels,
runs the queue, and is the thing you point at with `kill -TERM`. The
hardest production failures in real agent runtimes happen at the
edges of the lifecycle — start during start, stop during start, stop
during stop, crash during stop. We get those right first.

---

## What you implement

`runtime/daemon/daemon.ts` — replace the `notImplemented(...)` calls
with a working `Daemon` class.

### Required surface

```ts
class Daemon {
  constructor(opts: DaemonOptions)
  get state(): DaemonState  // "stopped" | "starting" | "running" | "stopping"
  async start(): Promise<void>
  async stop(): Promise<void>
  status(): DaemonStatus
}
```

### Required behavior

1. **State machine.** Legal transitions:
   - `stopped → starting → running`
   - `running → stopping → stopped`
   - Anything else throws.
2. **PID file.** During `start()`, write the current `process.pid` to
   `opts.pidFile` (default: `<workspace>/runtime.pid`).
   - The PID file must contain only the pid as a decimal string.
   - It must be removed during `stop()`.
3. **Stale PID file detection.** If the PID file exists at the start
   of `start()`, check whether the recorded pid is alive (`kill(pid, 0)`).
   - If alive: throw with a clear message — another daemon is already running.
   - If dead: log a warning, remove the stale file, continue.
4. **Idempotent start/stop.**
   - `start()` called when already `running` is a no-op (returns immediately).
   - `stop()` called when already `stopped` is a no-op.
5. **Lifecycle hooks.**
   - `opts.onStart` runs **after** the state becomes `running` and the
     PID file has been written. If the hook throws, the daemon
     transitions back to `stopped` and the PID file is removed.
   - `opts.onStop` runs **before** the state becomes `stopped` and the
     PID file is removed.
6. **Status.** `status()` always returns the truth without mutating
   state. After a stopped daemon was once running, `startedAt` is
   `null` again.

### Test invariants

- After `start()`, `state === "running"` and `status().pid` is the
  current process pid.
- After `stop()`, `state === "stopped"` and the PID file does not exist.
- Concurrent `start()` calls do not produce two PID files.
- A failing `onStart` rolls the state back to `stopped`.

---

## Run the tests

```
bun run stage 1
```

You should see a long failure list pointing at
`runtime/daemon/daemon.ts`. That's correct — your first edit should
make at least one of them pass.

---

## Hints

- A small private state field plus a guard at the top of each method
  is enough. You don't need an `EventEmitter` or a state machine
  library.
- For the PID file, use `fs.writeFileSync` for now. Atomic write is
  Stage 2's concern; here, the failure mode of a half-written PID file
  is "next start refuses, user investigates."
- `process.kill(pid, 0)` throws ESRCH when the pid is dead. That's
  how Unix asks "is this process alive?" without actually signalling
  it. Tests pass `installSignalHandlers: false` so you do not need to
  register SIGINT/SIGTERM handlers in test mode.
- Tests do **not** call `process.exit`. Your daemon must not call it
  either; clean up state explicitly.

---

## Stuck?

```
bun run stage solve 1
```

prints the path to the reference implementation. Read it, don't copy
it — the rest of the course assumes you understand this stage's
state machine cold.
