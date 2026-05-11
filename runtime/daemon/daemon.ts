/**
 * Stage 1 — Daemon skeleton.
 *
 * Implement a long-running runtime that exposes start/stop/status,
 * writes a PID file, and shuts down gracefully on stop().
 *
 * Reference solution: solutions/01-daemon/daemon.ts
 */

import type { Clock, DaemonState, DaemonStatus, Logger } from "../types";
import { notImplemented } from "../util/not-implemented";

export interface DaemonOptions {
  workspace: string;
  pidFile?: string;
  clock?: Clock;
  logger?: Logger;
  /** Hook fired during start() after PID file write. */
  onStart?: () => Promise<void> | void;
  /** Hook fired during stop() before PID file removal. */
  onStop?: () => Promise<void> | void;
  /** If true, register process signal handlers. Tests pass false. */
  installSignalHandlers?: boolean;
}

export class Daemon {
  constructor(_opts: DaemonOptions) {
    // No-op so we can be constructed in tests; methods throw below.
  }

  get state(): DaemonState {
    return notImplemented("01-daemon", "daemon/daemon", "implement state getter");
  }

  async start(): Promise<void> {
    return notImplemented("01-daemon", "daemon/daemon", "implement start()");
  }

  async stop(): Promise<void> {
    return notImplemented("01-daemon", "daemon/daemon", "implement stop()");
  }

  status(): DaemonStatus {
    return notImplemented("01-daemon", "daemon/daemon", "implement status()");
  }
}
