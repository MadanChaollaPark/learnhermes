import type { LogLevel, Logger } from "../types";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(options: {
  level?: LogLevel;
  /** Sink is the function that actually receives log lines. Default = stderr. */
  sink?: (line: string) => void;
} = {}): Logger {
  const level = options.level ?? "info";
  const threshold = LEVELS[level];
  const sink = options.sink ?? ((line) => process.stderr.write(line + "\n"));

  function emit(lvl: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVELS[lvl] < threshold) return;
    const ts = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? " " + JSON.stringify(meta) : "";
    sink(`${ts} ${lvl.toUpperCase()} ${msg}${metaStr}`);
  }

  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}

/** A logger that captures lines for assertion in tests. */
export function createCapturingLogger(level: LogLevel = "debug"): Logger & { lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({ level, sink: (l) => lines.push(l) });
  return Object.assign(logger, { lines });
}
