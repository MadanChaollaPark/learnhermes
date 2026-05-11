/**
 * Stage 7 — Permissions / sandbox policy.
 *
 * Evaluate (skill, action, scope) tuples against a set of PolicyRules.
 * Default verdicts:
 *   - fs.read    inside workspace → allow; outside → deny
 *   - fs.write   inside workspace → allow; outside → deny
 *   - shell      → deny
 *   - net.fetch  → deny
 *   - secrets.read → deny
 *
 * Deny takes precedence over allow at equal precedence.
 *
 * Approval gates: a `prompt` verdict calls the approve() callback. If
 * approved, the approval is recorded (skill, action, scope) so future
 * identical requests are auto-allowed.
 *
 * Reference solution: solutions/07-permissions/policy.ts
 */

import type {
  Logger,
  PermissionAction,
  PermissionVerdict,
  PolicyRule,
} from "../types";
import { notImplemented } from "../util/not-implemented";
import type { Store } from "../store/store";

export interface PolicyOptions {
  workspace: string;
  rules: PolicyRule[];
  store?: Store; // optional: persist approvals
  logger?: Logger;
  /** Callback to ask the user (mocked in tests). */
  approve?: (req: { skill: string; action: PermissionAction; scope?: string }) => Promise<boolean>;
}

export class Policy {
  constructor(_opts: PolicyOptions) {}

  async evaluate(
    skill: string,
    action: PermissionAction,
    scope?: string,
  ): Promise<{ verdict: PermissionVerdict; reason: string }> {
    void skill; void action; void scope;
    return notImplemented("07-permissions", "permissions/policy", "implement evaluate()");
  }

  /** Convenience: throws if denied, resolves if allowed (after prompt approval if needed). */
  async require(skill: string, action: PermissionAction, scope?: string): Promise<void> {
    void skill; void action; void scope;
    return notImplemented("07-permissions", "permissions/policy", "implement require()");
  }
}
