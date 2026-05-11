/**
 * Reference implementation for Stage 8.
 *
 * Memory is a thin layer over the Store. It exists so the rest of
 * the runtime never reaches into the memories collection directly —
 * scope filtering, budget enforcement, and injection all live here.
 */

import type {
  Logger,
  MemoryEntry,
  MemoryQuery,
  MemoryScope,
} from "@runtime/types";
import type { Store } from "@runtime/store/store";
import { newId } from "@runtime/util/ids";

export interface MemoryOptions {
  store: Store;
  logger?: Logger;
  userBudget?: number;
  injectionBudget?: number;
}

const DEFAULT_USER_BUDGET = 2200;
const DEFAULT_INJECTION_BUDGET = 1000;

export class Memory {
  private store: Store;
  private logger?: Logger;
  private userBudget: number;
  private injectionBudget: number;

  constructor(opts: MemoryOptions) {
    this.store = opts.store;
    this.logger = opts.logger;
    this.userBudget = opts.userBudget ?? DEFAULT_USER_BUDGET;
    this.injectionBudget = opts.injectionBudget ?? DEFAULT_INJECTION_BUDGET;
  }

  async write(entry: {
    content: string;
    tags?: string[];
    scope: MemoryScope;
  }): Promise<MemoryEntry> {
    const now = Date.now();
    const rec: MemoryEntry = {
      id: newId("mem"),
      content: entry.content,
      tags: entry.tags ?? [],
      scope: entry.scope,
      createdAt: now,
      updatedAt: now,
    };

    if (entry.scope.kind === "user") {
      await this.enforceUserBudget(rec.content.length);
    }

    await this.store.put("memories", rec as MemoryEntry & Record<string, unknown>);
    return rec;
  }

  async read(id: string): Promise<MemoryEntry | null> {
    return this.store.get<MemoryEntry & Record<string, unknown>>("memories", id);
  }

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    const all = await this.store.list<MemoryEntry & Record<string, unknown>>("memories");
    let out = all.filter((m) => {
      if (query.scope && !scopeEqual(m.scope, query.scope)) return false;
      if (query.tags && query.tags.length > 0) {
        for (const t of query.tags) if (!m.tags.includes(t)) return false;
      }
      if (query.search) {
        const needle = query.search.toLowerCase();
        const hay = (m.content + " " + m.tags.join(" ")).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    if (typeof query.limit === "number") out = out.slice(0, query.limit);
    return out;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete("memories", id);
  }

  async inject(query: MemoryQuery): Promise<string> {
    const matches = await this.search(query);
    if (matches.length === 0) return "";
    const out: string[] = [];
    let total = 0;
    for (const m of matches) {
      const add = (out.length === 0 ? "" : "\n---\n") + m.content;
      if (total + add.length > this.injectionBudget) break;
      out.push(out.length === 0 ? m.content : "\n---\n" + m.content);
      total += add.length;
    }
    return out.join("");
  }

  // ── internals ────────────────────────────────────────────────────────

  private async enforceUserBudget(incoming: number): Promise<void> {
    if (incoming >= this.userBudget) {
      // The new entry alone exceeds the budget — drop ALL user memories
      // to make room, but still allow the write.
      const all = await this.userScopeEntries();
      for (const e of all) {
        await this.store.delete("memories", e.id);
        this.logger?.warn("memory.evicted", { id: e.id, reason: "single entry over budget" });
      }
      return;
    }
    let current = await this.totalUserBytes();
    if (current + incoming <= this.userBudget) return;
    const entries = (await this.userScopeEntries()).sort((a, b) => a.updatedAt - b.updatedAt);
    for (const e of entries) {
      if (current + incoming <= this.userBudget) break;
      await this.store.delete("memories", e.id);
      current -= e.content.length;
      this.logger?.warn("memory.evicted", { id: e.id, reason: "budget" });
    }
  }

  private async userScopeEntries(): Promise<MemoryEntry[]> {
    const all = await this.store.list<MemoryEntry & Record<string, unknown>>("memories");
    return all.filter((m) => m.scope.kind === "user");
  }

  private async totalUserBytes(): Promise<number> {
    const all = await this.userScopeEntries();
    return all.reduce((sum, m) => sum + m.content.length, 0);
  }
}

function scopeEqual(a: MemoryScope, b: MemoryScope): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
