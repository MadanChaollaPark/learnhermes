/**
 * Reference implementation for Stage 12.
 *
 * The wiring object. The actual logic lives in the modules; this
 * file just shows how they connect, and what the "message" job
 * handler does end-to-end.
 */

import { join } from "node:path";
import type {
  AIClient,
  Channel,
  Clock,
  Job,
  Logger,
  MessageEnvelope,
  PermissionAction,
  PolicyRule,
  RuntimeEvent,
} from "@runtime/types";
import { Store } from "@runtime/store/store";
import { SkillRegistry } from "@runtime/skills/registry";
import { Policy } from "@runtime/permissions/policy";
import { Memory } from "@runtime/memory/memory";
import { Ledger } from "@runtime/ledger/ledger";
import { SubagentRunner } from "@runtime/subagents/subagent";
import { JobQueue } from "@runtime/queue/queue";
import { Scheduler } from "@runtime/scheduler/scheduler";
import { Gateway } from "@runtime/gateway/gateway";

export interface RuntimeOptions {
  workspace: string;
  channels: Channel[];
  ai: AIClient;
  clock: Clock;
  logger?: Logger;
  rules?: PolicyRule[];
  approve?: (req: { skill: string; action: PermissionAction; scope?: string }) => Promise<boolean>;
}

const TOOLS = ["memory.write", "delegation", "echo"];

export class Runtime {
  store!: Store;
  registry!: SkillRegistry;
  policy!: Policy;
  memory!: Memory;
  ledger!: Ledger;
  subagents!: SubagentRunner;
  queue!: JobQueue;
  scheduler!: Scheduler;
  gateway!: Gateway;

  private opts: RuntimeOptions;
  private started = false;

  constructor(opts: RuntimeOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const { workspace, channels, ai, clock, logger, rules, approve } = this.opts;

    this.store = new Store({ workspace });
    await this.store.open();

    this.registry = new SkillRegistry({
      roots: [{ path: join(workspace, "skills"), origin: "workspace" }],
      logger,
    });
    await this.registry.load();

    this.policy = new Policy({
      workspace,
      rules: rules ?? [],
      store: this.store,
      logger,
      approve,
    });

    this.memory = new Memory({ store: this.store, logger });
    this.ledger = new Ledger({ store: this.store, clock, logger });
    this.subagents = new SubagentRunner({ ai, memory: this.memory, policy: this.policy, clock, logger });

    this.queue = new JobQueue({
      store: this.store,
      clock,
      logger,
      backoff: { baseMs: 100, factor: 2, maxMs: 10_000 },
      defaultMaxAttempts: 3,
    });
    this.scheduler = new Scheduler({ store: this.store, queue: this.queue, clock, logger });

    // Register handlers BEFORE the gateway can deliver events.
    this.queue.register("message", (job) => this.handleMessage(job as Job<MessageEnvelope>));

    this.gateway = new Gateway({
      channels,
      onEvent: (ev) => this.onEvent(ev),
    });
    await this.gateway.start();

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.gateway.stop();
    await this.store.close();
    this.started = false;
  }

  // ── internals ────────────────────────────────────────────────────────

  private async onEvent(ev: RuntimeEvent): Promise<void> {
    if (ev.kind !== "message" || !ev.envelope) return;
    const env = ev.envelope;
    await this.queue.enqueue({
      kind: "message",
      payload: env,
      idempotencyKey: `${env.channel}:${env.id}`,
    });
    await this.queue.tick();
  }

  private async handleMessage(job: Job<MessageEnvelope>): Promise<void> {
    const env = job.payload;
    const led = await this.ledger.start("message", { envId: env.id, jobId: job.id });

    const context = await this.memory.inject({ scope: { kind: "user" } });
    const system = `You are an agent. Memory:\n${context}`;

    let response;
    try {
      response = await this.opts.ai.complete({
        system,
        messages: [{ role: "user", content: env.body }],
        tools: TOOLS,
        requestId: led.id,
      });
    } catch (e) {
      await this.ledger.log(led.id, { level: "error", msg: `ai error: ${(e as Error).message}` });
      await this.ledger.transition(led.id, "failed");
      throw e;
    }

    const replyParts: string[] = [response.text];
    for (const tc of response.toolCalls ?? []) {
      try {
        const fragment = await this.runTool(led.id, tc.tool, tc.args);
        if (fragment) replyParts.push(fragment);
      } catch (e) {
        await this.ledger.log(led.id, { level: "warn", msg: `tool ${tc.tool}: ${(e as Error).message}` });
      }
    }

    const replyText = replyParts.join("\n").trim();
    await this.gateway.send(env.channel, { thread: env.thread, sender: env.sender }, replyText);
    await this.ledger.transition(led.id, "completed");
  }

  private async runTool(ledId: string, tool: string, args: Record<string, unknown>): Promise<string | null> {
    switch (tool) {
      case "memory.write": {
        try {
          await this.policy.require("agent", "fs.write", this.opts.workspace);
        } catch (e) {
          await this.ledger.log(ledId, {
            level: "warn",
            msg: `permission denied for memory.write: ${(e as Error).message}`,
          });
          return null;
        }
        const content = String(args.content ?? "");
        if (!content) return null;
        await this.memory.write({ content, scope: { kind: "user" } });
        return null;
      }
      case "delegation": {
        const goal = String(args.goal ?? "");
        if (!goal) return null;
        const result = await this.subagents.delegate({ goal, depth: 0 });
        return result.summary;
      }
      case "echo":
        return String(args.text ?? "");
      default:
        await this.ledger.log(ledId, { level: "warn", msg: `unknown tool: ${tool}` });
        return null;
    }
  }
}
