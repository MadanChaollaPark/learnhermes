import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Make a unique temp directory under ./tmp/test-<rand>/. Returns
 * both the absolute path and a cleanup function. Tests are
 * expected to call cleanup in afterEach (or use the `withWorkspace`
 * helper below).
 *
 * Why ./tmp instead of os.tmpdir(): keeps everything under the repo
 * root so test artifacts are easy to inspect. The directory is
 * gitignored.
 */

import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = resolve(HERE, "..", "..", "tmp");

export interface Workspace {
  path: string;
  cleanup: () => void;
}

export function makeWorkspace(label = "ws"): Workspace {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
  const path = mkdtempSync(join(TMP_ROOT, `${label}-`));
  return {
    path,
    cleanup: () => {
      try { rmSync(path, { recursive: true, force: true }); } catch { /* swallow */ }
    },
  };
}

/** Helper for `await withWorkspace(async (ws) => { ... })`. */
export async function withWorkspace<T>(fn: (ws: Workspace) => Promise<T>): Promise<T> {
  const ws = makeWorkspace();
  try {
    return await fn(ws);
  } finally {
    ws.cleanup();
  }
}

/** Alternative: pass the *system* tmpdir if you'd rather not pollute ./tmp. */
export function makeSystemWorkspace(label = "lh"): Workspace {
  const path = mkdtempSync(join(tmpdir(), `${label}-`));
  return {
    path,
    cleanup: () => {
      try { rmSync(path, { recursive: true, force: true }); } catch { /* swallow */ }
    },
  };
}
