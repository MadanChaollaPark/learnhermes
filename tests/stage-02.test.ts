import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "@runtime/store/store";
import { makeWorkspace, type Workspace } from "@tests/mocks";
import { newId } from "@runtime/util/ids";

describe("Stage 2 — Durable store", () => {
  let ws: Workspace;
  beforeEach(() => { ws = makeWorkspace("store"); });
  afterEach(() => { ws.cleanup(); });

  it("put/get round-trips a record", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    const rec = { id: "m1", text: "hello", at: 12345 };
    await s.put("messages", rec);
    const got = await s.get("messages", "m1");
    expect(got).toEqual(rec);
    await s.close();
  });

  it("get returns null for missing record", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    expect(await s.get("messages", "nope")).toBeNull();
    await s.close();
  });

  it("list returns every record without filter", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    for (let i = 0; i < 5; i++) await s.put("messages", { id: `m${i}`, n: i });
    const all = await s.list("messages");
    expect(all).toHaveLength(5);
    expect(all.map((r) => r.id).sort()).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    await s.close();
  });

  it("list applies the filter", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    for (let i = 0; i < 5; i++) await s.put<{ id: string; n: number }>("messages", { id: `m${i}`, n: i });
    const evens = await s.list<{ id: string; n: number }>("messages", (r) => r.n % 2 === 0);
    expect(evens.map((r) => r.n).sort()).toEqual([0, 2, 4]);
    await s.close();
  });

  it("delete returns true for existing, false for missing", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    await s.put("messages", { id: "x", v: 1 });
    expect(await s.delete("messages", "x")).toBe(true);
    expect(await s.delete("messages", "x")).toBe(false);
    expect(await s.get("messages", "x")).toBeNull();
    await s.close();
  });

  it("data survives close + reopen (the whole point)", async () => {
    const a = new Store({ workspace: ws.path });
    await a.open();
    await a.put("jobs", { id: "j1", kind: "demo", payload: { hello: "world" } });
    await a.close();

    const b = new Store({ workspace: ws.path });
    await b.open();
    const got = await b.get("jobs", "j1");
    expect(got).toEqual({ id: "j1", kind: "demo", payload: { hello: "world" } });
    await b.close();
  });

  it("collections are independent", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    await s.put("messages", { id: "m", v: 1 });
    await s.put("jobs", { id: "j", v: 2 });
    expect(await s.get("messages", "j")).toBeNull();
    expect(await s.get("jobs", "m")).toBeNull();
    await s.close();
  });

  it("does not leave .tmp files behind after writes", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    for (let i = 0; i < 20; i++) await s.put("messages", { id: `m${i}`, n: i });
    await s.close();
    const dir = join(ws.path, "store");
    if (existsSync(dir)) {
      const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
      expect(leftovers).toEqual([]);
    }
  });

  it("concurrent puts to the same collection do not lose data", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        s.put("messages", { id: `m${i}`, n: i }),
      ),
    );
    const all = await s.list("messages");
    expect(all).toHaveLength(N);
    await s.close();
  });

  it("recovers from a pre-existing corrupt file by treating it as empty (but does not crash)", async () => {
    // Simulate an interrupted write: corrupt JSON in a collection file.
    const storeDir = join(ws.path, "store");
    require("node:fs").mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "messages.json"), "{not json", "utf8");
    const s = new Store({ workspace: ws.path });
    await s.open();
    // Should not throw; should treat the collection as empty.
    const all = await s.list("messages");
    expect(all).toEqual([]);
    // And a fresh put should succeed.
    await s.put("messages", { id: "fresh", v: 1 });
    expect(await s.get("messages", "fresh")).toEqual({ id: "fresh", v: 1 });
    await s.close();
  });

  it("put with an existing id replaces (last-write-wins)", async () => {
    const s = new Store({ workspace: ws.path });
    await s.open();
    await s.put("messages", { id: "x", v: 1 });
    await s.put("messages", { id: "x", v: 2, extra: "yes" });
    expect(await s.get("messages", "x")).toEqual({ id: "x", v: 2, extra: "yes" });
    await s.close();
  });
});
