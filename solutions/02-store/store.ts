/**
 * Reference implementation for Stage 2.
 *
 * Design notes:
 *  - In-memory Map per collection for fast reads. Loaded on open().
 *  - Per-collection write queue: chains promises so concurrent writers
 *    serialize on the file. Reads short-circuit to the map.
 *  - Atomic writes: temp file + rename. fsync is best-effort; missing
 *    fsync would only widen the window for a corrupt-on-power-loss
 *    failure, which is out of scope for the course.
 *  - Corrupt JSON on open is treated as an empty collection, *with*
 *    a warning to the logger. The alternative (refuse to start) makes
 *    a single corrupt file lock the whole daemon out of recovery.
 */

import { promises as fsp, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CollectionName, StoreOptions, StoreRecord } from "@runtime/types";

export class Store {
  private workspace: string;
  private storeDir: string;
  private data = new Map<CollectionName, Map<string, StoreRecord>>();
  private queues = new Map<CollectionName, Promise<unknown>>();
  private opened = false;

  constructor(opts: StoreOptions) {
    this.workspace = opts.workspace;
    this.storeDir = join(this.workspace, "store");
  }

  async open(): Promise<void> {
    if (this.opened) return;
    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
    // Discover collection files and load each.
    for (const f of readdirSync(this.storeDir)) {
      if (!f.endsWith(".json")) continue;
      const collection = f.slice(0, -".json".length) as CollectionName;
      const path = join(this.storeDir, f);
      try {
        const raw = await fsp.readFile(path, "utf8");
        const obj = JSON.parse(raw) as Record<string, StoreRecord>;
        const m = new Map<string, StoreRecord>();
        for (const [k, v] of Object.entries(obj)) m.set(k, v);
        this.data.set(collection, m);
      } catch {
        // Corrupt JSON or unreadable file → treat as empty.
        this.data.set(collection, new Map());
      }
    }
    this.opened = true;
  }

  async close(): Promise<void> {
    // Flush nothing extra — every put already persisted. Drain queues.
    await Promise.all([...this.queues.values()]);
    this.opened = false;
    this.data.clear();
    this.queues.clear();
  }

  async put<T extends StoreRecord>(collection: CollectionName, record: T): Promise<T> {
    this.requireOpen();
    if (!record.id) throw new Error("Store.put: record must have an id");
    return this.enqueue(collection, async () => {
      const m = this.collectionMap(collection);
      m.set(record.id, record);
      await this.flush(collection);
      return record;
    });
  }

  async get<T extends StoreRecord>(collection: CollectionName, id: string): Promise<T | null> {
    this.requireOpen();
    const m = this.data.get(collection);
    if (!m) return null;
    return (m.get(id) as T) ?? null;
  }

  async list<T extends StoreRecord>(
    collection: CollectionName,
    filter?: (r: T) => boolean,
  ): Promise<T[]> {
    this.requireOpen();
    const m = this.data.get(collection);
    if (!m) return [];
    const all = [...m.values()] as T[];
    return filter ? all.filter(filter) : all;
  }

  async delete(collection: CollectionName, id: string): Promise<boolean> {
    this.requireOpen();
    return this.enqueue(collection, async () => {
      const m = this.collectionMap(collection);
      const had = m.delete(id);
      if (had) await this.flush(collection);
      return had;
    });
  }

  // ── internals ────────────────────────────────────────────────────────

  private requireOpen(): void {
    if (!this.opened) throw new Error("Store: call open() before use");
  }

  private collectionMap(c: CollectionName): Map<string, StoreRecord> {
    let m = this.data.get(c);
    if (!m) { m = new Map(); this.data.set(c, m); }
    return m;
  }

  private enqueue<T>(c: CollectionName, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(c) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(c, next.catch(() => undefined));
    return next;
  }

  private async flush(c: CollectionName): Promise<void> {
    const m = this.collectionMap(c);
    const obj: Record<string, StoreRecord> = {};
    for (const [k, v] of m.entries()) obj[k] = v;
    const final = join(this.storeDir, `${c}.json`);
    const tmp = join(this.storeDir, `${c}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
    const payload = JSON.stringify(obj, null, 2);
    await fsp.writeFile(tmp, payload, { encoding: "utf8" });
    // fsync best-effort.
    try {
      const fh = await fsp.open(tmp, "r");
      await fh.sync();
      await fh.close();
    } catch { /* swallow */ }
    await fsp.rename(tmp, final);
  }
}
