/**
 * Stage 3 — Message gateway.
 *
 * Holds N channels, normalizes inbound MessageEnvelopes into
 * RuntimeEvents, routes outbound to the right channel.
 *
 * Reference solution: solutions/03-gateway/gateway.ts
 */

import type { Channel, ChannelId, MessageEnvelope, RuntimeEvent } from "../types";
import { notImplemented } from "../util/not-implemented";

export interface GatewayOptions {
  channels: Channel[];
  /** Called for every normalized inbound event. */
  onEvent: (e: RuntimeEvent) => void | Promise<void>;
}

export class Gateway {
  constructor(_opts: GatewayOptions) {}

  async start(): Promise<void> {
    return notImplemented("03-gateway", "gateway/gateway", "implement start()");
  }

  async stop(): Promise<void> {
    return notImplemented("03-gateway", "gateway/gateway", "implement stop()");
  }

  /** Called by channels when an envelope arrives. */
  async ingest(env: MessageEnvelope): Promise<void> {
    void env;
    return notImplemented("03-gateway", "gateway/gateway", "implement ingest()");
  }

  /** Route an outbound send to the right channel. */
  async send(channel: ChannelId, target: { thread?: string; sender?: string }, body: string): Promise<void> {
    void channel; void target; void body;
    return notImplemented("03-gateway", "gateway/gateway", "implement send()");
  }
}
