/**
 * `notImplemented` throws a structured error that the test suite knows
 * how to recognize. Stage stubs use this so the user sees a clear
 * pointer to the right stage README.
 *
 * The error message format is intentional: it shows up in the failing
 * test output and the user can grep "notImplemented" to find every
 * stub.
 */

export class NotImplementedError extends Error {
  readonly stage: string;
  readonly module: string;

  constructor(stage: string, module: string, hint?: string) {
    const tail = hint ? ` — ${hint}` : "";
    super(
      `Not implemented yet: ${module} (Stage ${stage}). ` +
        `Read stages/${stage}/README.md and implement in runtime/${module}.${tail}`,
    );
    this.name = "NotImplementedError";
    this.stage = stage;
    this.module = module;
  }
}

export function notImplemented(stage: string, module: string, hint?: string): never {
  throw new NotImplementedError(stage, module, hint);
}
