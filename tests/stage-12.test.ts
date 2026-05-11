import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { Runtime } from "@runtime/runtime/runtime";
import { FakeClock, MockAIClient, MockChannel, makeWorkspace, type Workspace } from "@tests/mocks";

async function flushAsync(): Promise<void> {
  // Let microtasks drain. The runtime's gateway handler is async — we
  // give it a few macrotask hops so all chained promises resolve before
  // assertions.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("Stage 12 — End-to-end", () => {
  let ws: Workspace;
  let cli: MockChannel;
  let ai: MockAIClient;
  let clock: FakeClock;
  let rt: Runtime;

  beforeEach(() => {
    ws = makeWorkspace("e2e");
    clock = new FakeClock(0);
    ai = new MockAIClient();
    cli = new MockChannel("cli", () => clock.now());
  });
  afterEach(async () => {
    try { await rt?.stop(); } catch { /* ignore */ }
    ws.cleanup();
  });

  it("inbound message produces an outbound reply", async () => {
    ai.queue({ text: "hi back" });
    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await cli.inject({ body: "hi", sender: "u1" });
    await flushAsync();
    expect(cli.outbox.map((m) => m.body)).toContain("hi back");
  });

  it("memory.write tool call writes a memory", async () => {
    ai.queue({
      text: "saved.",
      toolCalls: [{ tool: "memory.write", args: { content: "important fact" } }],
    });
    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await cli.inject({ body: "remember this", sender: "u1" });
    await flushAsync();
    const mems = await rt.memory.search({ scope: { kind: "user" } });
    expect(mems.map((m) => m.content)).toContain("important fact");
    expect(cli.outbox[0].body).toBe("saved.");
  });

  it("memory injected back into next message's system prompt", async () => {
    // First exchange: write a memory.
    ai.queue({
      text: "noted.",
      toolCalls: [{ tool: "memory.write", args: { content: "user prefers terse" } }],
    });
    // Second exchange: AI response (we'll inspect what it received).
    ai.queue({ text: "ok terse" });

    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await cli.inject({ body: "I prefer terse responses", sender: "u1" });
    await flushAsync();
    await cli.inject({ body: "what do you remember?", sender: "u1" });
    await flushAsync();

    expect(ai.calls.length).toBe(2);
    // Second call's system contains the memory we wrote in the first.
    expect(ai.calls[1].system ?? "").toContain("user prefers terse");
  });

  it("denied permission does not crash the job; reply still sent", async () => {
    ai.queue({
      text: "tried.",
      toolCalls: [
        { tool: "memory.write", args: { content: "bad", path: "/etc/passwd" } },
      ],
    });
    rt = new Runtime({
      workspace: ws.path, channels: [cli], ai, clock,
      // Force the memory.write to land outside workspace by injecting a rule.
      rules: [{ skill: "agent", action: "fs.write", verdict: "deny" }],
    });
    await rt.start();
    await cli.inject({ body: "save evil", sender: "u1" });
    await flushAsync();

    expect(cli.outbox.map((m) => m.body)).toContain("tried.");
    const led = await rt.ledger.list({ status: "completed" });
    expect(led.length).toBe(1);
    // Permission denial recorded as a warn log on the entry.
    const hasWarn = led[0].logs.some((l) => l.level === "warn" && /permission|deny|denied/i.test(l.msg));
    expect(hasWarn).toBe(true);
  });

  it("delegation tool call invokes the subagent runner", async () => {
    // Parent's AI response includes a delegation tool call.
    ai.match(/parent task/, {
      text: "delegating",
      toolCalls: [{ tool: "delegation", args: { goal: "analyze inputs" } }],
    });
    // Subagent's AI response (matched on its goal).
    ai.match(/analyze inputs/, { text: "subagent finished" });

    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await cli.inject({ body: "do parent task", sender: "u1" });
    await flushAsync();

    const reply = cli.outbox[0].body;
    expect(reply).toContain("delegating");
    expect(reply).toContain("subagent finished");
  });

  it("ledger has one completed entry per processed message", async () => {
    ai.queue({ text: "1" });
    ai.queue({ text: "2" });
    ai.queue({ text: "3" });
    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await cli.inject({ body: "a", sender: "u" });
    await flushAsync();
    await cli.inject({ body: "b", sender: "u" });
    await flushAsync();
    await cli.inject({ body: "c", sender: "u" });
    await flushAsync();

    const completed = await rt.ledger.list({ status: "completed" });
    expect(completed.length).toBe(3);
  });

  it("dedup: same envelope id is processed once", async () => {
    ai.queue({ text: "first" });
    ai.queue({ text: "second" });
    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await cli.inject({ id: "dup-1", body: "same", sender: "u" });
    await flushAsync();
    await cli.inject({ id: "dup-1", body: "same", sender: "u" });
    await flushAsync();
    expect(cli.outbox.length).toBe(1);
    expect(cli.outbox[0].body).toBe("first");
  });

  it("stop() shuts the channels and store cleanly", async () => {
    ai.queue({ text: "ok" });
    rt = new Runtime({ workspace: ws.path, channels: [cli], ai, clock });
    await rt.start();
    await rt.stop();
    await expect(cli.inject({ body: "post-stop", sender: "u" })).rejects.toThrow();
  });
});
