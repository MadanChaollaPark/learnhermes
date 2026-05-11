/**
 * Stage 2 — Durable store.
 *
 * A JSON-backed key/value store with collections. Writes must be
 * atomic enough that a process kill between operations does not
 * leave the file half-written.
 *
 * Reference solution: solutions/02-store/store.ts
 */

import type { CollectionName, StoreOptions, StoreRecord } from "../types";
import { notImplemented } from "../util/not-implemented";

export class Store {
  constructor(_opts: StoreOptions) {}

  async open(): Promise<void> {
    return notImplemented("02-store", "store/store", "implement open()");
  }

  async close(): Promise<void> {
    return notImplemented("02-store", "store/store", "implement close()");
  }

  async put<T extends StoreRecord>(collection: CollectionName, record: T): Promise<T> {
    void collection; void record;
    return notImplemented("02-store", "store/store", "implement put()");
  }

  async get<T extends StoreRecord>(collection: CollectionName, id: string): Promise<T | null> {
    void collection; void id;
    return notImplemented("02-store", "store/store", "implement get()");
  }

  async list<T extends StoreRecord>(
    collection: CollectionName,
    filter?: (r: T) => boolean,
  ): Promise<T[]> {
    void collection; void filter;
    return notImplemented("02-store", "store/store", "implement list()");
  }

  async delete(collection: CollectionName, id: string): Promise<boolean> {
    void collection; void id;
    return notImplemented("02-store", "store/store", "implement delete()");
  }
}
