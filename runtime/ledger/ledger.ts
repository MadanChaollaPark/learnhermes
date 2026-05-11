/**
 * Stage 11 — Background task ledger.
 *
 * Append-only record of background work: started/in_progress/completed/failed
 * with timestamps and structured logs. Supports resumption: pending entries
 * found after restart can be picked up via a resumeToken.
 *
 * Reference solution: solutions/11-ledger/ledger.ts
 */

import type { Clock, LedgerEntry, LedgerLog, LedgerStatus, Logger } from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";

export interface LedgerOptions {
  store: Store;
  clock: Clock;
  logger?: Logger;
}

export class Ledger {
  constructor(_opts: LedgerOptions) {}

  async start(kind: string, resumeToken?: unknown): Promise<LedgerEntry> {
    void kind; void resumeToken;
    return notImplemented("11-ledger", "ledger/ledger", "implement start()");
  }

  async log(id: string, log: Omit<LedgerLog, "at">): Promise<void> {
    void id; void log;
    return notImplemented("11-ledger", "ledger/ledger", "implement log()");
  }

  async transition(id: string, status: LedgerStatus): Promise<LedgerEntry> {
    void id; void status;
    return notImplemented("11-ledger", "ledger/ledger", "implement transition()");
  }

  async get(id: string): Promise<LedgerEntry | null> {
    void id;
    return notImplemented("11-ledger", "ledger/ledger", "implement get()");
  }

  async list(filter?: { status?: LedgerStatus; since?: number }): Promise<LedgerEntry[]> {
    void filter;
    return notImplemented("11-ledger", "ledger/ledger", "implement list()");
  }

  /** Entries left in started/in_progress that can be resumed after restart. */
  async resumable(): Promise<LedgerEntry[]> {
    return notImplemented("11-ledger", "ledger/ledger", "implement resumable()");
  }
}
