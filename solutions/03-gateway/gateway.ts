import type {
  Channel,
  ChannelId,
  MessageEnvelope,
  RuntimeEvent,
} from "@runtime/types";

export interface GatewayOptions {
  channels: Channel[];
  onEvent: (e: RuntimeEvent) => void | Promise<void>;
}

export class Gateway {
  private readonly channels = new Map<ChannelId, Channel>();
  private readonly onEvent: (e: RuntimeEvent) => void | Promise<void>;
  /** Dedup key is `${channelId}:${envelopeId}` so different channels with
   *  the same id are independent. */
  private readonly seen = new Set<string>();
  private started = false;

  constructor(opts: GatewayOptions) {
    for (const c of opts.channels) this.channels.set(c.id, c);
    this.onEvent = opts.onEvent;
  }

  async start(): Promise<void> {
    if (this.started) return;
    for (const ch of this.channels.values()) {
      ch.subscribe((env) => this.ingest(env));
      await ch.start();
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    for (const ch of this.channels.values()) {
      await ch.stop();
    }
    this.started = false;
  }

  async ingest(env: MessageEnvelope): Promise<void> {
    const key = `${env.channel}:${env.id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    await this.onEvent({
      kind: "message",
      envelope: env,
      source: env.channel,
      receivedAt: env.receivedAt,
    });
  }

  async send(
    channel: ChannelId,
    target: { thread?: string; sender?: string },
    body: string,
  ): Promise<void> {
    const ch = this.channels.get(channel);
    if (!ch) throw new Error(`Unknown channel: ${channel} (not registered with the gateway)`);
    await ch.send(target, body);
  }
}
