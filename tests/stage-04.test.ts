import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JobQueue } from "@runtime/queue/queue";
import { Store } from "@runtime/store/store";
import { FakeClock, makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 4 — Job queue", () => {
  let ws: Workspace;
  let clock: FakeClock;
  let store: Store;
  let queue: JobQueue;

  beforeEach(async () => {
    ws = makeWorkspace("queue");
    clock = new FakeClock(10_000);
    store = new Store({ workspace: ws.path });
    await store.open();
    queue = new JobQueue({
      store,
      clock,
      backoff: { baseMs: 100, factor: 2, maxMs: 10_000 },
      defaultMaxAttempts: 3,
    });
  });

  afterEach(async () => { await store.close(); ws.cleanup(); });

  it("enqueue produces a pending job at the current clock", async () => {
    const job = await queue.enqueue({ kind: "echo", payload: { msg: "hi" } });
    expect(job.status).toBe("pending");
    expect(job.attempt).toBe(0);
    expect(job.notBefore).toBe(10_000);
    expect(job.maxAttempts).toBe(3);
    expect(job.lastError).toBeNull();
  });

  it("tick runs registered handlers and marks success", async () => {
    let saw: unknown;
    queue.register<{ msg: string }>("echo", async (j) => { saw = j.payload.msg; });
    const job = await queue.enqueue({ kind: "echo", payload: { msg: "hello" } });

    const r = await queue.tick();
    expect(r.ran).toBe(1);
    expect(saw).toBe("hello");
    const after = await queue.get(job.id);
    expect(after?.status).toBe("succeeded");
    expect(after?.attempt).toBe(1);
  });

  it("a failing handler retries with backoff and does not run twice in one tick", async () => {
    let calls = 0;
    queue.register<{}>("boom", async () => { calls++; throw new Error("nope " + calls); });
    const job = await queue.enqueue({ kind: "boom", payload: {} });

    // First tick: attempt 1 fails. notBefore advances by 100ms.
    const r1 = await queue.tick();
    expect(r1.ran).toBe(1);
    let after = await queue.get(job.id);
    expect(after?.status).toBe("pending");
    expect(after?.attempt).toBe(1);
    expect(after?.notBefore).toBe(10_000 + 100);
    expect(after?.lastError).toMatch(/nope 1/);

    // Same tick should NOT re-run the same job.
    const r2 = await queue.tick();
    expect(r2.ran).toBe(0);
    after = await queue.get(job.id);
    expect(after?.status).toBe("pending");

    // Advance to retry time.
    await clock.advanceTo(10_000 + 100);
    const r3 = await queue.tick();
    expect(r3.ran).toBe(1);
    expect(calls).toBe(2);

    // Backoff doubles: next attempt at +300ms total (100 + 200).
    after = await queue.get(job.id);
    expect(after?.notBefore).toBe(10_000 + 100 + 200);
  });

  it("dead-letters after maxAttempts", async () => {
    queue.register<{}>("boom", async () => { throw new Error("always"); });
    const job = await queue.enqueue({ kind: "boom", payload: {}, maxAttempts: 2 });

    await queue.tick(); // attempt 1: fail
    await clock.advanceTo(10_000 + 100);
    await queue.tick(); // attempt 2: fail → dead_letter

    const after = await queue.get(job.id);
    expect(after?.status).toBe("dead_letter");
    expect(after?.attempt).toBe(2);

    // Advancing time further does NOT run dead-lettered jobs.
    await clock.advance(1_000_000);
    const r = await queue.tick();
    expect(r.ran).toBe(0);
  });

  it("idempotency key returns existing job and does not run twice", async () => {
    let calls = 0;
    queue.register<{}>("once", async () => { calls++; });
    const a = await queue.enqueue({ kind: "once", payload: {}, idempotencyKey: "k1" });
    const b = await queue.enqueue({ kind: "once", payload: {}, idempotencyKey: "k1" });
    expect(b.id).toBe(a.id);

    await queue.tick();
    expect(calls).toBe(1);
  });

  it("respects notBefore for delayed jobs", async () => {
    queue.register<{}>("later", async () => {});
    const job = await queue.enqueue({ kind: "later", payload: {}, notBefore: 11_000 });

    await queue.tick(); // clock still at 10_000
    expect((await queue.get(job.id))?.status).toBe("pending");

    await clock.advanceTo(11_000);
    await queue.tick();
    expect((await queue.get(job.id))?.status).toBe("succeeded");
  });

  it("fails the job with a clear error when no handler is registered", async () => {
    const job = await queue.enqueue({ kind: "ghost", payload: {} });
    await queue.tick();
    const after = await queue.get(job.id);
    expect(after?.status).toBe("pending"); // first attempt failed, not dead-yet
    expect(after?.attempt).toBe(1);
    expect(after?.lastError).toMatch(/no handler|unregistered|ghost/i);
  });

  it("listByStatus filters", async () => {
    queue.register<{}>("ok", async () => {});
    queue.register<{}>("bad", async () => { throw new Error("x"); });
    await queue.enqueue({ kind: "ok", payload: {} });
    await queue.enqueue({ kind: "bad", payload: {}, maxAttempts: 1 });
    await queue.tick();
    expect((await queue.listByStatus("succeeded")).length).toBe(1);
    expect((await queue.listByStatus("dead_letter")).length).toBe(1);
  });

  it("recovers pending jobs after store close/reopen", async () => {
    queue.register<{}>("delayed", async () => {});
    const j = await queue.enqueue({ kind: "delayed", payload: {} });
    await store.close();

    const store2 = new Store({ workspace: ws.path });
    await store2.open();
    const queue2 = new JobQueue({
      store: store2, clock,
      backoff: { baseMs: 100, factor: 2, maxMs: 10_000 },
      defaultMaxAttempts: 3,
    });
    queue2.register<{}>("delayed", async () => {});
    await queue2.tick();
    const after = await queue2.get(j.id);
    expect(after?.status).toBe("succeeded");
    await store2.close();
  });
});
