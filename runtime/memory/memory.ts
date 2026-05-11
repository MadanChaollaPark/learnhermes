/**
 * Stage 8 — Persistent memory.
 *
 * write/read/search backed by Store. Bounded budget enforced on
 * scope = {kind: "user"}. Context injection returns memories ranked
 * by query relevance, capped by token budget.
 *
 * Reference solution: solutions/08-memory/memory.ts
 */

import type { Logger, MemoryEntry, MemoryQuery, MemoryScope } from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";

export interface MemoryOptions {
  store: Store;
  logger?: Logger;
  /** Char budget for user-scope memory. Default 2200 (Hermes). */
  userBudget?: number;
  /** Char budget per context injection. Default 1000. */
  injectionBudget?: number;
}

export class Memory {
  constructor(_opts: MemoryOptions) {}

  async write(entry: {
    content: string;
    tags?: string[];
    scope: MemoryScope;
  }): Promise<MemoryEntry> {
    void entry;
    return notImplemented("08-memory", "memory/memory", "implement write()");
  }

  async read(id: string): Promise<MemoryEntry | null> {
    void id;
    return notImplemented("08-memory", "memory/memory", "implement read()");
  }

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    void query;
    return notImplemented("08-memory", "memory/memory", "implement search()");
  }

  async delete(id: string): Promise<boolean> {
    void id;
    return notImplemented("08-memory", "memory/memory", "implement delete()");
  }

  /** Returns the system-prompt fragment to inject for a given query. */
  async inject(query: MemoryQuery): Promise<string> {
    void query;
    return notImplemented("08-memory", "memory/memory", "implement inject()");
  }
}
