/**
 * Reference implementation for Stage 1.
 *
 * Notes on design:
 *  - A single private `_state` plus per-method guards is enough.
 *    A finite-state-machine library is overkill at this size.
 *  - PID file is written *before* state flips to running, so an
 *    onStart hook can observe it. It is removed *after* the onStop
 *    hook so the hook can still log the lifecycle.
 *  - Stale-PID detection uses `process.kill(pid, 0)` which throws
 *    ESRCH when the pid is dead. EPERM means it exists but is
 *    owned by another user; we treat that as "alive" to avoid
 *    racing two daemons.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Clock, DaemonState, DaemonStatus, Logger } from "@runtime/types";

export interface DaemonOptions {
  workspace: string;
  pidFile?: string;
  clock?: Clock;
  logger?: Logger;
  onStart?: () => Promise<void> | void;
  onStop?: () => Promise<void> | void;
  installSignalHandlers?: boolean;
}

export class Daemon {
  private _state: DaemonState = "stopped";
  private _startedAt: number | null = null;
  private readonly workspace: string;
  private readonly pidFile: string;
  private readonly clock: { now: () => number };
  private readonly logger: Logger | undefined;
  private readonly onStart: DaemonOptions["onStart"];
  private readonly onStop: DaemonOptions["onStop"];

  constructor(opts: DaemonOptions) {
    this.workspace = opts.workspace;
    this.pidFile = opts.pidFile ?? join(opts.workspace, "runtime.pid");
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.logger = opts.logger;
    this.onStart = opts.onStart;
    this.onStop = opts.onStop;
  }

  get state(): DaemonState { return this._state; }

  status(): DaemonStatus {
    return {
      state: this._state,
      pid: this._state === "running" ? process.pid : null,
      startedAt: this._state === "running" ? this._startedAt : null,
      workspace: this.workspace,
    };
  }

  async start(): Promise<void> {
    if (this._state === "running") return; // idempotent
    if (this._state !== "stopped") {
      throw new Error(`Cannot start daemon in state "${this._state}"`);
    }
    this._state = "starting";
    try {
      this.ensureWorkspace();
      this.checkPidFile();
      writeFileSync(this.pidFile, String(process.pid), { encoding: "utf8" });
      this._startedAt = this.clock.now();
      if (this.onStart) await this.onStart();
      this._state = "running";
      this.logger?.info("daemon.started", { pid: process.pid });
    } catch (err) {
      // Roll back: remove PID file, reset state.
      try { if (existsSync(this.pidFile)) unlinkSync(this.pidFile); } catch { /* swallow */ }
      this._startedAt = null;
      this._state = "stopped";
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this._state === "stopped") return; // idempotent
    if (this._state === "starting") {
      throw new Error('Cannot stop while starting; illegal transition');
    }
    if (this._state !== "running") {
      throw new Error(`Cannot stop daemon in state "${this._state}"`);
    }
    this._state = "stopping";
    try {
      if (this.onStop) await this.onStop();
    } finally {
      try { if (existsSync(this.pidFile)) unlinkSync(this.pidFile); } catch { /* swallow */ }
      this._startedAt = null;
      this._state = "stopped";
      this.logger?.info("daemon.stopped");
    }
  }

  private ensureWorkspace(): void {
    if (!existsSync(this.workspace)) {
      require("node:fs").mkdirSync(this.workspace, { recursive: true });
    }
  }

  private checkPidFile(): void {
    if (!existsSync(this.pidFile)) return;
    const raw = readFileSync(this.pidFile, "utf8").trim();
    const recorded = Number(raw);
    if (!Number.isFinite(recorded) || recorded <= 0) {
      this.logger?.warn("daemon.pidFile.malformed", { raw });
      unlinkSync(this.pidFile);
      return;
    }
    if (isAlive(recorded)) {
      throw new Error(
        `Another daemon is already running with pid ${recorded} (pid file: ${this.pidFile})`,
      );
    }
    this.logger?.warn("daemon.pidFile.stale", { pid: recorded });
    unlinkSync(this.pidFile);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // signal sent successfully
  } catch (err: any) {
    if (err?.code === "ESRCH") return false;
    if (err?.code === "EPERM") return true; // exists, owned by someone else
    return false;
  }
}
