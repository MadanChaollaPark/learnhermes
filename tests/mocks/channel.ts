import type { Channel, ChannelId, MessageEnvelope } from "@runtime/types";
import { newId } from "@runtime/util/ids";

export interface SentMessage {
  target: { thread?: string; sender?: string };
  body: string;
  at: number;
}

/**
 * Programmable mock channel. Tests push inbound envelopes via inject()
 * and assert outbound through `outbox`.
 *
 * `id` is configurable so a single test can have a `telegram` and a
 * `discord` mock channel routed by the gateway.
 */
export class MockChannel implements Channel {
  readonly id: ChannelId;
  readonly outbox: SentMessage[] = [];
  private handlers: ((env: MessageEnvelope) => void | Promise<void>)[] = [];
  private started = false;
  private getNow: () => number;

  constructor(id: ChannelId, now: () => number = () => 0) {
    this.id = id;
    this.getNow = now;
  }

  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }

  async send(target: { thread?: string; sender?: string }, body: string): Promise<void> {
    if (!this.started) throw new Error(`MockChannel(${this.id}): send before start`);
    this.outbox.push({ target, body, at: this.getNow() });
  }

  subscribe(handler: (env: MessageEnvelope) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  /** Test-only: push an inbound envelope as if the channel had received it. */
  async inject(partial: Partial<MessageEnvelope> & { body: string; sender: string }): Promise<void> {
    if (!this.started) throw new Error(`MockChannel(${this.id}): inject before start`);
    const env: MessageEnvelope = {
      id: partial.id ?? newId("mock-env"),
      channel: this.id,
      sender: partial.sender,
      body: partial.body,
      thread: partial.thread,
      receivedAt: partial.receivedAt ?? this.getNow(),
      meta: partial.meta,
    };
    for (const h of this.handlers) {
      await h(env);
    }
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }
}
