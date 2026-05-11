/**
 * Stage 3 — CLI channel.
 *
 * The CLI is the simplest possible channel: stdin is inbound,
 * stdout is outbound. For tests, you do not need to bind real
 * stdin; the Channel interface lets tests inject envelopes
 * via the gateway's `ingest()` directly.
 *
 * Reference solution: solutions/03-gateway/channels/cli.ts
 */

import type { Channel, MessageEnvelope } from "../../types";
import { notImplemented } from "../../util/not-implemented";

export class CliChannel implements Channel {
  readonly id = "cli";

  async start(): Promise<void> {
    return notImplemented("03-gateway", "gateway/channels/cli", "implement start()");
  }

  async stop(): Promise<void> {
    return notImplemented("03-gateway", "gateway/channels/cli", "implement stop()");
  }

  async send(target: { thread?: string; sender?: string }, body: string): Promise<void> {
    void target; void body;
    return notImplemented("03-gateway", "gateway/channels/cli", "implement send()");
  }

  subscribe(handler: (env: MessageEnvelope) => void | Promise<void>): void {
    void handler;
    notImplemented("03-gateway", "gateway/channels/cli", "implement subscribe()");
  }
}
