/**
 * Deterministic-friendly id generation.
 *
 * The default `newId()` uses crypto for runtime use.
 * Tests use `setIdSequence(["a", "b", "c"])` to make ids predictable.
 */

import { randomUUID } from "node:crypto";

let sequence: string[] | null = null;
let sequenceIdx = 0;

export function setIdSequence(ids: string[] | null): void {
  sequence = ids;
  sequenceIdx = 0;
}

export function newId(prefix?: string): string {
  if (sequence !== null) {
    const id = sequence[sequenceIdx++];
    if (id === undefined) {
      throw new Error(
        `Id sequence exhausted after ${sequenceIdx} ids. ` +
          `Set a longer sequence via setIdSequence().`,
      );
    }
    return prefix ? `${prefix}_${id}` : id;
  }
  const v = randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${v}` : v;
}
