/**
 * Reference implementation for Stage 11.
 *
 * Append-only-ish: we persist the whole entry on every mutation. The
 * "append-only" claim is about callers not erasing history, not
 * about the on-disk encoding being literally append.
 */

import type {
  Clock,
  LedgerEntry,
  LedgerLog,
  LedgerStatus,
  Logger,
  StoreRecord,
} from "@runtime/types";
import type { Store } from "@runtime/store/store";
import { newId } from "@runtime/util/ids";

export interface LedgerOptions {
  store: Store;
  clock: Clock;
  logger?: Logger;
}

const SEALED: Set<LedgerStatus> = new Set(["completed", "failed"]);

const LEGAL: Record<LedgerStatus, Set<LedgerStatus>> = {
  started:     new Set<LedgerStatus>(["in_progress", "completed", "failed"]),
  in_progress: new Set<LedgerStatus>(["in_progress", "completed", "failed"]),
  completed:   new Set<LedgerStatus>(),
  failed:      new Set<LedgerStatus>(),
};

export class Ledger {
  private store: Store;
  private clock: Clock;
  private logger?: Logger;

  constructor(opts: LedgerOptions) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.logger = opts.logger;
  }

  async start(kind: string, resumeToken?: unknown): Promise<LedgerEntry> {
    const now = this.clock.now();
    const entry: LedgerEntry = {
      id: newId("led"),
      kind,
      status: "started",
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      logs: [],
      resumeToken,
    };
    await this.store.put("ledger", entry as LedgerEntry & StoreRecord);
    this.logger?.debug("ledger.start", { id: entry.id, kind });
    return entry;
  }

  async log(id: string, log: Omit<LedgerLog, "at">): Promise<void> {
    const e = await this.requireEntry(id);
    if (SEALED.has(e.status)) {
      throw new Error(`ledger entry ${id} is sealed (${e.status})`);
    }
    const now = this.clock.now();
    const updated: LedgerEntry = {
      ...e,
      logs: [...e.logs, { at: now, level: log.level, msg: log.msg }],
      updatedAt: now,
    };
    await this.store.put("ledger", updated as LedgerEntry & StoreRecord);
  }

  async transition(id: string, status: LedgerStatus): Promise<LedgerEntry> {
    const e = await this.requireEntry(id);
    if (!LEGAL[e.status].has(status)) {
      throw new Error(`illegal transition ${e.status} → ${status} on ${id}`);
    }
    const now = this.clock.now();
    const updated: LedgerEntry = {
      ...e,
      status,
      updatedAt: now,
      completedAt: SEALED.has(status) ? now : e.completedAt,
    };
    await this.store.put("ledger", updated as LedgerEntry & StoreRecord);
    return updated;
  }

  async get(id: string): Promise<LedgerEntry | null> {
    return this.store.get<LedgerEntry & StoreRecord>("ledger", id);
  }

  async list(filter?: { status?: LedgerStatus; since?: number }): Promise<LedgerEntry[]> {
    const all = await this.store.list<LedgerEntry & StoreRecord>("ledger");
    let out = all;
    if (filter?.status) out = out.filter((e) => e.status === filter.status);
    if (typeof filter?.since === "number") {
      const since = filter.since;
      out = out.filter((e) => e.updatedAt >= since);
    }
    return [...out].sort((a, b) => b.startedAt - a.startedAt);
  }

  async resumable(): Promise<LedgerEntry[]> {
    const all = await this.store.list<LedgerEntry & StoreRecord>("ledger");
    return all
      .filter((e) => e.status === "started" || e.status === "in_progress")
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  // ── internals ────────────────────────────────────────────────────────

  private async requireEntry(id: string): Promise<LedgerEntry> {
    const e = await this.store.get<LedgerEntry & StoreRecord>("ledger", id);
    if (!e) throw new Error(`ledger entry not found: ${id}`);
    return e;
  }
}
