#!/usr/bin/env bun
/**
 * Internal verification helper. Copies every solutions/<stage>/<file>.ts
 * over the matching runtime/<module>/<file>.ts so we can run vitest
 * against the *finished* runtime. Reverts on demand.
 *
 *   bun scripts/swap-solutions.ts apply        # copy solutions → runtime
 *   bun scripts/swap-solutions.ts restore      # restore stubs
 *
 * Stub copies are kept in scripts/.stubs-backup/<module>/<file>.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const BACKUP = join(ROOT, "scripts", ".stubs-backup");

// solutionPath → runtimePath
const MAP: Record<string, string> = {
  "solutions/01-daemon/daemon.ts":       "runtime/daemon/daemon.ts",
  "solutions/02-store/store.ts":         "runtime/store/store.ts",
  "solutions/03-gateway/gateway.ts":     "runtime/gateway/gateway.ts",
  "solutions/03-gateway/cli.ts":         "runtime/gateway/channels/cli.ts",
  "solutions/04-queue/queue.ts":         "runtime/queue/queue.ts",
  "solutions/05-scheduler/scheduler.ts": "runtime/scheduler/scheduler.ts",
  "solutions/06-skills/registry.ts":     "runtime/skills/registry.ts",
  "solutions/07-permissions/policy.ts":  "runtime/permissions/policy.ts",
  "solutions/08-memory/memory.ts":       "runtime/memory/memory.ts",
  "solutions/09-subagents/subagent.ts":  "runtime/subagents/subagent.ts",
  "solutions/10-learning/learner.ts":    "runtime/learning/learner.ts",
  "solutions/11-ledger/ledger.ts":       "runtime/ledger/ledger.ts",
  "solutions/12-end-to-end/runtime.ts":  "runtime/runtime/runtime.ts",
};

const cmd = process.argv[2];
if (cmd === "apply") apply();
else if (cmd === "restore") restore();
else { console.error("usage: bun scripts/swap-solutions.ts apply|restore"); process.exit(2); }

function apply(): void {
  mkdirSync(BACKUP, { recursive: true });
  for (const [sol, rt] of Object.entries(MAP)) {
    const solAbs = join(ROOT, sol);
    const rtAbs = join(ROOT, rt);
    const backupAbs = join(BACKUP, rt);
    if (!existsSync(solAbs)) { console.error(`missing: ${sol}`); process.exit(1); }
    if (!existsSync(rtAbs))  { console.error(`missing: ${rt}`); process.exit(1); }
    if (!existsSync(backupAbs)) {
      mkdirSync(dirname(backupAbs), { recursive: true });
      writeFileSync(backupAbs, readFileSync(rtAbs));
    }
    writeFileSync(rtAbs, readFileSync(solAbs));
    console.log(`apply: ${sol} → ${rt}`);
  }
}

function restore(): void {
  for (const rt of Object.values(MAP)) {
    const rtAbs = join(ROOT, rt);
    const backupAbs = join(BACKUP, rt);
    if (!existsSync(backupAbs)) { console.warn(`no backup: ${rt}`); continue; }
    writeFileSync(rtAbs, readFileSync(backupAbs));
    console.log(`restore: ${rt}`);
  }
}
