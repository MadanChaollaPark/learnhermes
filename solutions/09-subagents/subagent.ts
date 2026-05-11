/**
 * Reference implementation for Stage 9.
 *
 * Subagent isolation rules in one place. Every other module that
 * needs to fan work out into "another agent" routes through here.
 */

import type {
  AIClient,
  Clock,
  Logger,
  SubagentRequest,
  SubagentResult,
} from "@runtime/types";
import { newId } from "@runtime/util/ids";
import type { Memory } from "@runtime/memory/memory";
import type { Policy } from "@runtime/permissions/policy";

export interface SubagentRunnerOptions {
  ai: AIClient;
  memory: Memory;
  policy: Policy;
  clock: Clock;
  logger?: Logger;
  maxDepth?: number;
  maxConcurrent?: number;
  childTimeoutMs?: number;
}

const FORBIDDEN_TOOLS = new Set(["delegation", "memory.write", "send_message"]);
const HARD_DEPTH_CAP = 3;
const HARD_CONCURRENT_CAP = 16;

const TIMEOUT_SENTINEL = Symbol("timeout");

export class SubagentRunner {
  private ai: AIClient;
  private memory: Memory;
  private policy: Policy;
  private clock: Clock;
  private logger?: Logger;
  private maxDepth: number;
  private maxConcurrent: number;
  private childTimeoutMs: number;

  constructor(opts: SubagentRunnerOptions) {
    this.ai = opts.ai;
    this.memory = opts.memory;
    this.policy = opts.policy;
    this.clock = opts.clock;
    this.logger = opts.logger;
    this.maxDepth = Math.min(opts.maxDepth ?? 2, HARD_DEPTH_CAP);
    this.maxConcurrent = Math.min(opts.maxConcurrent ?? 3, HARD_CONCURRENT_CAP);
    this.childTimeoutMs = opts.childTimeoutMs ?? 600_000;
    void this.memory; void this.policy;
  }

  async delegate(req: SubagentRequest): Promise<SubagentResult> {
    const id = req.id ?? newId("sub");
    const startedAt = this.clock.now();

    if (req.depth >= this.maxDepth) {
      this.logger?.warn("subagent.depth", { id, depth: req.depth, max: this.maxDepth });
      return {
        id, status: "failed",
        summary: "depth exceeded",
        error: `depth ${req.depth} >= max ${this.maxDepth}`,
        startedAt, completedAt: this.clock.now(),
      };
    }

    const tools = this.filterTools(req.toolsets);
    const system = buildSystemPrompt(req);
    const aiCall = this.ai.complete({
      system,
      messages: [{ role: "user", content: req.goal }],
      tools,
      requestId: id,
    });

    const timeoutAt = startedAt + this.childTimeoutMs;
    const timeoutP: Promise<typeof TIMEOUT_SENTINEL> =
      this.clock.sleepUntil(timeoutAt).then(() => TIMEOUT_SENTINEL);

    try {
      const winner = await Promise.race([aiCall, timeoutP]);
      if (winner === TIMEOUT_SENTINEL) {
        return {
          id, status: "timeout",
          summary: "child timed out",
          error: `exceeded ${this.childTimeoutMs}ms`,
          startedAt, completedAt: this.clock.now(),
        };
      }
      return {
        id, status: "succeeded",
        summary: winner.text,
        output: winner,
        startedAt, completedAt: this.clock.now(),
      };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger?.warn("subagent.failed", { id, error: msg });
      return {
        id, status: "failed",
        summary: `ai error: ${msg}`,
        error: msg,
        startedAt, completedAt: this.clock.now(),
      };
    }
  }

  async delegateMany(reqs: SubagentRequest[]): Promise<SubagentResult[]> {
    const results: SubagentResult[] = new Array(reqs.length);
    let next = 0;
    const workers: Promise<void>[] = [];
    const lanes = Math.min(this.maxConcurrent, reqs.length);
    for (let i = 0; i < lanes; i++) {
      workers.push((async () => {
        while (true) {
          const idx = next++;
          if (idx >= reqs.length) return;
          results[idx] = await this.delegate(reqs[idx]);
        }
      })());
    }
    await Promise.all(workers);
    return results;
  }

  // ── internals ────────────────────────────────────────────────────────

  private filterTools(requested: string[] | undefined): string[] {
    const pool = requested ?? [];
    return pool.filter((t) => !FORBIDDEN_TOOLS.has(t));
  }
}

function buildSystemPrompt(req: SubagentRequest): string {
  const lines = [
    `You are a subagent. Goal: ${req.goal}`,
  ];
  if (req.context && req.context.trim() !== "") {
    lines.push(`Parent context: ${req.context}`);
  }
  lines.push("You CANNOT see the parent's history. Complete the goal with the tools you have.");
  return lines.join("\n");
}
