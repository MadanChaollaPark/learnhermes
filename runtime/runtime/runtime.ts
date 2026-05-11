/**
 * Stage 12 — End-to-end runtime.
 *
 * Wires every prior stage into one object:
 *
 *   channel.inject(env)
 *     → Gateway → RuntimeEvent
 *     → Queue ("message" job)
 *     → Memory.inject + Policy + Subagent + AI
 *     → channel.send(reply)
 *     → Ledger.completed
 *
 * Reference solution: solutions/12-end-to-end/runtime.ts
 */

import type {
  AIClient,
  Channel,
  Clock,
  Logger,
  PermissionAction,
  PolicyRule,
} from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";
import type { SkillRegistry } from "../skills/registry";
import type { Policy } from "../permissions/policy";
import type { Memory } from "../memory/memory";
import type { Ledger } from "../ledger/ledger";
import type { SubagentRunner } from "../subagents/subagent";
import type { JobQueue } from "../queue/queue";
import type { Scheduler } from "../scheduler/scheduler";
import type { Gateway } from "../gateway/gateway";

export interface RuntimeOptions {
  workspace: string;
  channels: Channel[];
  ai: AIClient;
  clock: Clock;
  logger?: Logger;
  rules?: PolicyRule[];
  approve?: (req: { skill: string; action: PermissionAction; scope?: string }) => Promise<boolean>;
}

export class Runtime {
  // The implementer assigns these in start().
  store!: Store;
  registry!: SkillRegistry;
  policy!: Policy;
  memory!: Memory;
  ledger!: Ledger;
  subagents!: SubagentRunner;
  queue!: JobQueue;
  scheduler!: Scheduler;
  gateway!: Gateway;

  constructor(_opts: RuntimeOptions) {}

  async start(): Promise<void> {
    return notImplemented("12-end-to-end", "runtime/runtime", "implement start()");
  }

  async stop(): Promise<void> {
    return notImplemented("12-end-to-end", "runtime/runtime", "implement stop()");
  }
}
