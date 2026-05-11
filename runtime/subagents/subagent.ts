/**
 * Stage 9 — Subagents.
 *
 * delegate(req) creates an isolated child agent:
 *  - separate session (its own message history, never sees parent's)
 *  - separate memory scope (its writes don't pollute parent)
 *  - restricted toolsets (default: NO `delegation`/`memory`/`send_message`)
 *  - depth cap (default max 2; hard cap 3)
 *  - failure isolation (a thrown child returns status="failed", parent
 *    continues)
 *
 * Reference solution: solutions/09-subagents/subagent.ts
 */

import type { AIClient, Clock, Logger, SubagentRequest, SubagentResult } from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Memory } from "../memory/memory";
import type { Policy } from "../permissions/policy";

export interface SubagentRunnerOptions {
  ai: AIClient;
  memory: Memory;
  policy: Policy;
  clock: Clock;
  logger?: Logger;
  /** Hard max depth. Default 2; runtime cap is 3. */
  maxDepth?: number;
  /** Max concurrent children per delegate() call. Default 3; cap 16. */
  maxConcurrent?: number;
  /** Child idle timeout. Default 600s. */
  childTimeoutMs?: number;
}

export class SubagentRunner {
  constructor(_opts: SubagentRunnerOptions) {}

  /** Run one subagent. Returns a SubagentResult; does NOT throw on child failure. */
  async delegate(req: SubagentRequest): Promise<SubagentResult> {
    void req;
    return notImplemented("09-subagents", "subagents/subagent", "implement delegate()");
  }

  /** Run multiple subagents in parallel, bounded by maxConcurrent. */
  async delegateMany(reqs: SubagentRequest[]): Promise<SubagentResult[]> {
    void reqs;
    return notImplemented("09-subagents", "subagents/subagent", "implement delegateMany()");
  }
}
