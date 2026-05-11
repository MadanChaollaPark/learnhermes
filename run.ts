#!/usr/bin/env bun
/**
 * Stage runner.
 *
 *   bun run stage 1            # run stage 1 tests
 *   bun run stage 1 --watch    # run stage 1 tests in watch mode
 *   bun run stage list         # list all stages
 *   bun run stage solve 1      # show the reference solution path
 *
 * Equivalent npm form:
 *   npm run stage -- 1
 *
 * The runner is deliberately thin: it picks the right vitest filter
 * and spawns vitest. The course is the tests + the stub runtime, not
 * the runner.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES_DIR = resolve(HERE, "stages");
const TESTS_DIR = resolve(HERE, "tests");
const SOLUTIONS_DIR = resolve(HERE, "solutions");
void TESTS_DIR;

type StageMeta = { num: number; slug: string; dir: string };

function discoverStages(): StageMeta[] {
  if (!existsSync(STAGES_DIR)) return [];
  return readdirSync(STAGES_DIR)
    .filter((name) => /^\d{2}-/.test(name))
    .map((name) => {
      const dir = join(STAGES_DIR, name);
      if (!statSync(dir).isDirectory()) return null;
      const [numPart, ...slugParts] = name.split("-");
      return { num: Number(numPart), slug: slugParts.join("-"), dir };
    })
    .filter((x): x is StageMeta => x !== null)
    .sort((a, b) => a.num - b.num);
}

function findStage(arg: string): StageMeta | undefined {
  const stages = discoverStages();
  const n = Number(arg);
  if (!Number.isFinite(n)) return undefined;
  return stages.find((s) => s.num === n);
}

function help(): void {
  const stages = discoverStages();
  console.log("learnhermes — build an OpenClaw/Hermes-style persistent agent runtime");
  console.log("");
  console.log("Usage:");
  console.log("  bun run stage <n>            run tests for stage <n>");
  console.log("  bun run stage <n> --watch    watch mode");
  console.log("  bun run stage list           list all stages");
  console.log("  bun run stage solve <n>      print the reference solution path");
  console.log("");
  console.log("Stages:");
  for (const s of stages) {
    console.log(`  ${String(s.num).padStart(2, "0")}  ${s.slug}`);
  }
  console.log("");
  console.log("Solutions live in solutions/. Stub runtime lives in runtime/.");
  console.log("Implement inside runtime/ until the tests pass.");
}

function listStages(): void {
  const stages = discoverStages();
  for (const s of stages) {
    const readme = join(s.dir, "README.md");
    const hasReadme = existsSync(readme) ? "" : "  (missing README)";
    console.log(`Stage ${String(s.num).padStart(2, "0")}  ${s.slug}${hasReadme}`);
  }
}

function showSolution(arg: string): void {
  const stage = findStage(arg);
  if (!stage) {
    console.error(`Unknown stage: ${arg}`);
    process.exit(2);
  }
  const sol = join(SOLUTIONS_DIR, `${String(stage.num).padStart(2, "0")}-${stage.slug}`);
  if (!existsSync(sol)) {
    console.error(`No solution directory for stage ${stage.num} at ${sol}`);
    process.exit(2);
  }
  console.log(sol);
}

function runStage(arg: string, rest: string[]): never {
  const stage = findStage(arg);
  if (!stage) {
    console.error(`Unknown stage: ${arg}`);
    console.error(`Run: bun run stage list`);
    process.exit(2);
  }
  const padded = String(stage.num).padStart(2, "0");
  const filter = `tests/stage-${padded}.test.ts`;
  const watchIdx = rest.indexOf("--watch");
  const watch = watchIdx >= 0;
  const args = watch
    ? ["vitest", filter]
    : ["vitest", "run", filter];

  const banner = `\n── Stage ${padded} — ${stage.slug} ─────────────────────────────────`;
  console.log(banner);
  console.log(`Reading: ${join(stage.dir, "README.md")}`);
  console.log(`Tests:   ${filter}`);
  console.log(`Implement inside runtime/. Reference solution in solutions/${padded}-${stage.slug}/`);
  console.log("");

  const result = spawnSync("bun", ["x", ...args], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  help();
  process.exit(0);
}
if (cmd === "list") {
  listStages();
  process.exit(0);
}
if (cmd === "solve") {
  const target = rest[0];
  if (!target) {
    console.error("Usage: bun run stage solve <n>");
    process.exit(2);
  }
  showSolution(target);
  process.exit(0);
}
// Default form: `bun run stage <n>` → first positional is the stage number.
runStage(cmd, rest);
