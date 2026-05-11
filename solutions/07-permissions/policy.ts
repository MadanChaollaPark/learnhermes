/**
 * Reference implementation for Stage 7.
 *
 * The Policy is the only authority on "may this skill do X?". Every
 * other module routes through it via require().
 */

import { resolve } from "node:path";
import type {
  Logger,
  PermissionAction,
  PermissionVerdict,
  PolicyRule,
} from "@runtime/types";
import type { Store } from "@runtime/store/store";
import { newId } from "@runtime/util/ids";

export interface PolicyOptions {
  workspace: string;
  rules: PolicyRule[];
  store?: Store;
  logger?: Logger;
  approve?: (req: { skill: string; action: PermissionAction; scope?: string }) => Promise<boolean>;
}

interface ApprovalRecord {
  id: string;
  skill: string;
  action: PermissionAction;
  scope: string;
  grantedAt: number;
  [k: string]: unknown;
}

const VERDICT_DENY_RANK: Record<PermissionVerdict, number> = {
  deny: 2,
  allow: 1,
  prompt: 0,
};

export class Policy {
  private workspace: string;
  private rules: PolicyRule[];
  private store?: Store;
  private logger?: Logger;
  private approve?: PolicyOptions["approve"];

  constructor(opts: PolicyOptions) {
    this.workspace = resolve(opts.workspace);
    this.rules = opts.rules;
    this.store = opts.store;
    this.logger = opts.logger;
    this.approve = opts.approve;
  }

  async evaluate(
    skill: string,
    action: PermissionAction,
    scope?: string,
  ): Promise<{ verdict: PermissionVerdict; reason: string }> {
    // 1. Find matching rules.
    const matches = this.rules
      .filter((r) => this.ruleMatches(r, skill, action, scope))
      .map((r) => ({ rule: r, score: this.scoreRule(r) }))
      .sort((a, b) => {
        // higher precedence first
        const pa = a.rule.precedence ?? 0;
        const pb = b.rule.precedence ?? 0;
        if (pa !== pb) return pb - pa;
        // specificity (higher score first)
        if (a.score !== b.score) return b.score - a.score;
        // deny > allow > prompt
        return VERDICT_DENY_RANK[b.rule.verdict] - VERDICT_DENY_RANK[a.rule.verdict];
      });

    let verdict: PermissionVerdict;
    let reason: string;

    if (matches.length > 0) {
      verdict = matches[0].rule.verdict;
      reason = `rule: skill=${matches[0].rule.skill} action=${action} verdict=${verdict}`;
    } else {
      const def = this.defaultVerdict(action, scope);
      verdict = def.verdict;
      reason = def.reason;
    }

    if (verdict === "prompt") {
      return await this.runApproval(skill, action, scope);
    }
    return { verdict, reason };
  }

  async require(skill: string, action: PermissionAction, scope?: string): Promise<void> {
    const r = await this.evaluate(skill, action, scope);
    if (r.verdict === "allow") return;
    throw new Error(`permission denied: ${skill} ${action} ${scope ?? ""} — ${r.reason}`);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private ruleMatches(
    r: PolicyRule,
    skill: string,
    action: PermissionAction,
    scope: string | undefined,
  ): boolean {
    if (r.skill !== "*" && r.skill !== skill) return false;
    if (r.action !== action) return false;
    if (r.scope === undefined) return true;
    if (scope === undefined) return false;
    if (r.scope.endsWith("/*")) {
      return scope.startsWith(r.scope.slice(0, -2));
    }
    return r.scope === scope;
  }

  private scoreRule(r: PolicyRule): number {
    let s = 0;
    if (r.skill !== "*") s += 2;
    if (r.scope !== undefined) s += 1;
    return s;
  }

  private defaultVerdict(
    action: PermissionAction,
    scope: string | undefined,
  ): { verdict: PermissionVerdict; reason: string } {
    switch (action) {
      case "fs.read":
      case "fs.write": {
        if (scope === undefined) {
          return { verdict: "deny", reason: `default-deny: ${action} requires a scope` };
        }
        const real = resolve(scope);
        const root = this.workspace;
        if (real === root || real.startsWith(root + (root.endsWith("/") ? "" : "/"))) {
          return { verdict: "allow", reason: `default-allow: ${action} inside workspace` };
        }
        return { verdict: "deny", reason: `default-deny: ${action} outside workspace` };
      }
      case "shell":
      case "net.fetch":
      case "secrets.read":
        return { verdict: "deny", reason: `default-deny: ${action}` };
    }
  }

  private approvalId(skill: string, action: PermissionAction, scope: string | undefined): string {
    return `${skill}::${action}::${scope ?? ""}`;
  }

  private async runApproval(
    skill: string,
    action: PermissionAction,
    scope: string | undefined,
  ): Promise<{ verdict: PermissionVerdict; reason: string }> {
    const id = this.approvalId(skill, action, scope);

    // Cached approval?
    if (this.store) {
      const cached = await this.store.get<ApprovalRecord>("approvals", id);
      if (cached) {
        return { verdict: "allow", reason: "cached approval" };
      }
    }

    if (!this.approve) {
      return { verdict: "deny", reason: "no approver configured" };
    }

    const ok = await this.approve({ skill, action, scope });
    if (!ok) {
      this.logger?.info("policy.approval.denied", { skill, action, scope });
      return { verdict: "deny", reason: "user declined approval" };
    }

    if (this.store) {
      const rec: ApprovalRecord = {
        id,
        skill,
        action,
        scope: scope ?? "",
        grantedAt: Date.now(),
      };
      await this.store.put("approvals", rec);
    }
    this.logger?.info("policy.approval.granted", { skill, action, scope });
    return { verdict: "allow", reason: "user approved" };
  }
}

// `newId` is imported so the file shape matches its sibling modules.
// Approvals use a deterministic id (above), so we don't actually call it.
void newId;
