import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SubagentRunner } from "@runtime/subagents/subagent";
import { Memory } from "@runtime/memory/memory";
import { Policy } from "@runtime/permissions/policy";
import { Store } from "@runtime/store/store";
import { FakeClock, MockAIClient, makeWorkspace, type Workspace } from "@tests/mocks";

describe("Stage 9 — Subagents", () => {
  let ws: Workspace;
  let store: Store;
  let memory: Memory;
  let policy: Policy;
  let ai: MockAIClient;
  let clock: FakeClock;
  let runner: SubagentRunner;

  beforeEach(async () => {
    ws = makeWorkspace("sub");
    store = new Store({ workspace: ws.path });
    await store.open();
    memory = new Memory({ store });
    policy = new Policy({ workspace: ws.path, rules: [] });
    ai = new MockAIClient();
    clock = new FakeClock(0);
    runner = new SubagentRunner({ ai, memory, policy, clock });
  });
  afterEach(async () => { await store.close(); ws.cleanup(); });

  it("rejects when depth exceeds maxDepth without invoking AI", async () => {
    const r = await runner.delegate({ goal: "x", depth: 2 }); // default maxDepth=2
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/depth/i);
    expect(ai.calls.length).toBe(0);
  });

  it("filters forbidden tools out of the forwarded request", async () => {
    ai.queue({ text: "done" });
    await runner.delegate({
      goal: "read a file",
      depth: 0,
      toolsets: ["fs.read", "delegation", "memory.write", "send_message"],
    });
    expect(ai.calls.length).toBe(1);
    const sentTools = ai.calls[0].tools ?? [];
    expect(sentTools).toContain("fs.read");
    expect(sentTools).not.toContain("delegation");
    expect(sentTools).not.toContain("memory.write");
    expect(sentTools).not.toContain("send_message");
  });

  it("system prompt mentions the goal and isolates history", async () => {
    ai.queue({ text: "ok" });
    await runner.delegate({ goal: "summarize the README", depth: 0 });
    const sys = ai.calls[0].system ?? "";
    expect(sys).toMatch(/summarize the README/);
    expect(sys.toLowerCase()).toMatch(/cannot.*parent.*history|parent.*history.*cannot/);
  });

  it("does not forward parent context as `messages` history", async () => {
    ai.queue({ text: "ok" });
    await runner.delegate({ goal: "do thing", context: "parent said hi", depth: 0 });
    // The user message MUST be the goal, not parent history.
    const msgs = ai.calls[0].messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("do thing");
    // Parent context may appear in the system prompt, but not as a prior message.
    for (const m of msgs) {
      expect(m.content).not.toBe("parent said hi");
    }
  });

  it("returns succeeded with summary on AI text response", async () => {
    ai.queue({ text: "the answer is 42" });
    const r = await runner.delegate({ goal: "find the answer", depth: 0 });
    expect(r.status).toBe("succeeded");
    expect(r.summary).toBe("the answer is 42");
    expect(r.startedAt).toBeTypeOf("number");
    expect(r.completedAt).toBeGreaterThanOrEqual(r.startedAt);
  });

  it("isolates AI failure (delegate does not throw)", async () => {
    // No queued responses → ai.complete throws.
    const r = await runner.delegate({ goal: "boom", depth: 0 });
    expect(r.status).toBe("failed");
    expect(r.error).toBeTruthy();
    expect(r.summary.toLowerCase()).toContain("error");
  });

  it("delegateMany returns results in input order", async () => {
    ai.match(/alpha/, { text: "A" });
    ai.match(/bravo/, { text: "B" });
    ai.match(/charlie/, { text: "C" });
    const results = await runner.delegateMany([
      { goal: "alpha", depth: 0 },
      { goal: "bravo", depth: 0 },
      { goal: "charlie", depth: 0 },
    ]);
    expect(results.map((r) => r.summary)).toEqual(["A", "B", "C"]);
    expect(results.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("delegateMany respects maxConcurrent", async () => {
    let inflight = 0;
    let peak = 0;
    const slow = new MockAIClient();
    slow.complete = async (req) => {
      slow.calls.push(req);
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return { text: "ok" };
    };
    const r2 = new SubagentRunner({
      ai: slow, memory, policy, clock, maxConcurrent: 2,
    });
    const reqs = Array.from({ length: 6 }, (_, i) => ({ goal: `g${i}`, depth: 0 }));
    const results = await r2.delegateMany(reqs);
    expect(results).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("times out via the clock", async () => {
    const stuck = new MockAIClient();
    stuck.complete = () => new Promise(() => { /* never resolves */ });
    const r3 = new SubagentRunner({
      ai: stuck, memory, policy, clock, childTimeoutMs: 10,
    });
    const p = r3.delegate({ goal: "stuck", depth: 0 });
    await clock.advance(11);
    const result = await p;
    expect(result.status).toBe("timeout");
  });

  it("one failing child does not poison sibling results", async () => {
    ai.match(/alpha/, { text: "A" });
    // bravo has no scripted response → throws.
    ai.match(/charlie/, { text: "C" });
    const results = await runner.delegateMany([
      { goal: "alpha", depth: 0 },
      { goal: "bravo", depth: 0 },
      { goal: "charlie", depth: 0 },
    ]);
    expect(results[0].status).toBe("succeeded");
    expect(results[1].status).toBe("failed");
    expect(results[2].status).toBe("succeeded");
  });
});
