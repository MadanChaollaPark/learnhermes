/**
 * Reference CliChannel.
 *
 * For the course we only need to satisfy the Channel interface. Tests
 * use MockChannel for I/O. If you want a real CLI channel, swap the
 * subscribe() body for a readline interface over process.stdin.
 */

import type { Channel, MessageEnvelope } from "@runtime/types";

export class CliChannel implements Channel {
  readonly id = "cli" as const;
  private handlers: ((env: MessageEnvelope) => void | Promise<void>)[] = [];
  private started = false;

  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }

  async send(_target: { thread?: string; sender?: string }, body: string): Promise<void> {
    if (!this.started) throw new Error("CliChannel.send before start");
    process.stdout.write(body + "\n");
  }

  subscribe(handler: (env: MessageEnvelope) => void | Promise<void>): void {
    this.handlers.push(handler);
  }
}
