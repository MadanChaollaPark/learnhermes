import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Ledger } from "@runtime/ledger/ledger";
import { Store } from "@runtime/store/store";
import { FakeClock, makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 11 — Ledger", () => {
  let ws: Workspace;
  let store: Store;
  let clock: FakeClock;
  let ledger: Ledger;

  beforeEach(async () => {
    ws = makeWorkspace("led");
    store = new Store({ workspace: ws.path });
    await store.open();
    clock = new FakeClock(1000);
    ledger = new Ledger({ store, clock });
  });
  afterEach(async () => { await store.close(); ws.cleanup(); });

  it("start creates an entry in 'started'", async () => {
    const e = await ledger.start("job:summarize", { url: "x" });
    expect(e.id).toMatch(/^led/);
    expect(e.kind).toBe("job:summarize");
    expect(e.status).toBe("started");
    expect(e.startedAt).toBe(1000);
    expect(e.completedAt).toBeNull();
    expect(e.logs).toEqual([]);
    expect(e.resumeToken).toEqual({ url: "x" });
  });

  it("log appends an entry with at=clock.now()", async () => {
    const e = await ledger.start("job", undefined);
    await clock.advanceTo(1500);
    await ledger.log(e.id, { level: "info", msg: "halfway" });
    const got = await ledger.get(e.id);
    expect(got?.logs).toHaveLength(1);
    expect(got?.logs[0]).toEqual({ at: 1500, level: "info", msg: "halfway" });
  });

  it("transition enforces legal moves", async () => {
    const e = await ledger.start("job", undefined);
    await ledger.transition(e.id, "in_progress");
    const e2 = await ledger.transition(e.id, "completed");
    expect(e2.status).toBe("completed");
    expect(e2.completedAt).toBe(clock.now());

    // Sealed: cannot transition again.
    await expect(ledger.transition(e.id, "in_progress")).rejects.toThrow();
  });

  it("transition to completed/failed sets completedAt", async () => {
    const a = await ledger.start("job", undefined);
    await clock.advanceTo(2000);
    const aDone = await ledger.transition(a.id, "completed");
    expect(aDone.completedAt).toBe(2000);

    const b = await ledger.start("job2", undefined);
    await clock.advanceTo(3000);
    const bFail = await ledger.transition(b.id, "failed");
    expect(bFail.completedAt).toBe(3000);
  });

  it("log on sealed entry throws", async () => {
    const e = await ledger.start("job", undefined);
    await ledger.transition(e.id, "completed");
    await expect(ledger.log(e.id, { level: "info", msg: "too late" })).rejects.toThrow();
  });

  it("transition with unknown id throws", async () => {
    await expect(ledger.transition("nope", "completed")).rejects.toThrow();
  });

  it("list filters by status and since", async () => {
    const a = await ledger.start("job", undefined);
    await clock.advanceTo(1100);
    const b = await ledger.start("job", undefined);
    await clock.advanceTo(1200);
    await ledger.transition(a.id, "completed");

    const completed = await ledger.list({ status: "completed" });
    expect(completed.map((e) => e.id)).toEqual([a.id]);

    const recent = await ledger.list({ since: 1150 });
    // Both updated at >= 1150 (a: completedAt=1200 → updatedAt=1200; b: startedAt=1100 → updatedAt=1100)
    // 'since' filters on updatedAt, so a should be included but not b.
    expect(recent.map((e) => e.id)).toEqual([a.id]);
  });

  it("list returns newest first by startedAt", async () => {
    const a = await ledger.start("a", undefined);
    await clock.advanceTo(1100);
    const b = await ledger.start("b", undefined);
    await clock.advanceTo(1200);
    const c = await ledger.start("c", undefined);
    const all = await ledger.list();
    expect(all.map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });

  it("resumable returns started + in_progress only", async () => {
    const a = await ledger.start("a", { i: 1 });
    const b = await ledger.start("b", { i: 2 });
    const c = await ledger.start("c", { i: 3 });
    await ledger.transition(b.id, "in_progress");
    await ledger.transition(c.id, "completed");

    const r = await ledger.resumable();
    const ids = r.map((e) => e.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("survives Store close/open", async () => {
    const e = await ledger.start("durable", { token: "abc" });
    await ledger.log(e.id, { level: "info", msg: "before close" });
    await store.close();

    const store2 = new Store({ workspace: ws.path });
    await store2.open();
    const ledger2 = new Ledger({ store: store2, clock });
    const back = await ledger2.get(e.id);
    expect(back?.id).toBe(e.id);
    expect(back?.kind).toBe("durable");
    expect(back?.resumeToken).toEqual({ token: "abc" });
    expect(back?.logs).toHaveLength(1);
    await store2.close();
    await store.open();
  });
});
