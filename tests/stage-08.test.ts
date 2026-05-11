import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Memory } from "@runtime/memory/memory";
import { Store } from "@runtime/store/store";
import { makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 8 — Persistent memory", () => {
  let ws: Workspace;
  let store: Store;
  let mem: Memory;

  beforeEach(async () => {
    ws = makeWorkspace("memory");
    store = new Store({ workspace: ws.path });
    await store.open();
    mem = new Memory({ store });
  });
  afterEach(async () => { await store.close(); ws.cleanup(); });

  it("write → read round-trips", async () => {
    const e = await mem.write({
      content: "user likes terse responses",
      tags: ["preference"],
      scope: { kind: "user" },
    });
    expect(e.id).toMatch(/^mem/);
    const back = await mem.read(e.id);
    expect(back?.content).toBe("user likes terse responses");
    expect(back?.tags).toEqual(["preference"]);
    expect(back?.scope).toEqual({ kind: "user" });
    expect(back?.createdAt).toBeTypeOf("number");
  });

  it("search filters by scope", async () => {
    await mem.write({ content: "u1", scope: { kind: "user" } });
    await mem.write({ content: "s1", scope: { kind: "session", sessionId: "abc" } });
    const userOnly = await mem.search({ scope: { kind: "user" } });
    expect(userOnly.map((m) => m.content)).toEqual(["u1"]);
    const sess = await mem.search({ scope: { kind: "session", sessionId: "abc" } });
    expect(sess.map((m) => m.content)).toEqual(["s1"]);
  });

  it("search filters by tags (all-of)", async () => {
    await mem.write({ content: "a", tags: ["x"],       scope: { kind: "user" } });
    await mem.write({ content: "b", tags: ["x", "y"],  scope: { kind: "user" } });
    await mem.write({ content: "c", tags: ["y"],       scope: { kind: "user" } });
    const xy = await mem.search({ tags: ["x", "y"] });
    expect(xy.map((m) => m.content)).toEqual(["b"]);
  });

  it("search filters by substring (case-insensitive)", async () => {
    await mem.write({ content: "User prefers Terse output", scope: { kind: "user" } });
    await mem.write({ content: "ignore this one", scope: { kind: "user" } });
    const hits = await mem.search({ search: "terse" });
    expect(hits.map((m) => m.content)).toEqual(["User prefers Terse output"]);
  });

  it("search returns newest first", async () => {
    const a = await mem.write({ content: "first", scope: { kind: "user" } });
    // Force ordering: bump updatedAt manually by writing in sequence.
    await new Promise((r) => setTimeout(r, 2));
    const b = await mem.write({ content: "second", scope: { kind: "user" } });
    await new Promise((r) => setTimeout(r, 2));
    const c = await mem.write({ content: "third", scope: { kind: "user" } });
    const all = await mem.search({});
    expect(all.map((m) => m.id)).toEqual([c.id, b.id, a.id]);
  });

  it("evicts oldest user-scope memories when budget would overflow", async () => {
    const small = new Memory({ store, userBudget: 50 });
    const a = await small.write({ content: "x".repeat(20), scope: { kind: "user" } });
    await new Promise((r) => setTimeout(r, 2));
    const b = await small.write({ content: "y".repeat(20), scope: { kind: "user" } });
    await new Promise((r) => setTimeout(r, 2));
    // Total = 40. Adding 20 more would push to 60 > 50 → evict oldest (a).
    const c = await small.write({ content: "z".repeat(20), scope: { kind: "user" } });
    expect(await small.read(a.id)).toBeNull();
    expect((await small.read(b.id))?.id).toBe(b.id);
    expect((await small.read(c.id))?.id).toBe(c.id);
  });

  it("does not evict for non-user scopes", async () => {
    const small = new Memory({ store, userBudget: 50 });
    const a = await small.write({ content: "x".repeat(60), scope: { kind: "session", sessionId: "s1" } });
    expect((await small.read(a.id))?.id).toBe(a.id);
  });

  it("delete removes the entry", async () => {
    const e = await mem.write({ content: "doomed", scope: { kind: "user" } });
    expect(await mem.delete(e.id)).toBe(true);
    expect(await mem.read(e.id)).toBeNull();
    expect(await mem.delete(e.id)).toBe(false);
  });

  it("inject concatenates newest first, respects injectionBudget", async () => {
    const m = new Memory({ store, injectionBudget: 50 });
    await m.write({ content: "A".repeat(30), scope: { kind: "user" } });
    await new Promise((r) => setTimeout(r, 2));
    await m.write({ content: "B".repeat(30), scope: { kind: "user" } });
    const out = await m.inject({ scope: { kind: "user" } });
    // Newest (B) first; A would push over budget — stop.
    expect(out.startsWith("BBBBBBBBBB")).toBe(true);
    expect(out).not.toMatch(/A/);
  });

  it("inject returns empty string when nothing matches", async () => {
    expect(await mem.inject({ search: "no such thing" })).toBe("");
  });

  it("survives Store.close() and re-open()", async () => {
    const e = await mem.write({ content: "durable", scope: { kind: "user" } });
    await store.close();
    const store2 = new Store({ workspace: ws.path });
    await store2.open();
    const mem2 = new Memory({ store: store2 });
    const back = await mem2.read(e.id);
    expect(back?.content).toBe("durable");
    await store2.close();
    // Re-open for afterEach cleanup.
    await store.open();
  });
});
