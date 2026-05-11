import type { AIClient, AIRequest, AIResponse } from "@runtime/types";

/**
 * Mock AI client. Scripted responses by `requestId` or by matcher.
 *
 * Use:
 *   const ai = new MockAIClient();
 *   ai.queue({ text: "ok" });                // FIFO by call
 *   ai.queue({ text: "tool!", toolCalls: [{ tool: "x", args: {} }] });
 *   ai.script("req-id-1", { text: "exact" }); // by request id
 *   ai.match(/please.*help/i, { text: "ok" });// by content regex
 *
 * Tests should be deterministic — prefer .script() (by request id) over
 * .match() (by content) when you can.
 */

interface QueuedResponse { resp: AIResponse }
interface ScriptedResponse { id: string; resp: AIResponse }
interface MatcherResponse { re: RegExp; resp: AIResponse }

export class MockAIClient implements AIClient {
  readonly calls: AIRequest[] = [];
  private queueResponses: QueuedResponse[] = [];
  private scripted = new Map<string, ScriptedResponse>();
  private matchers: MatcherResponse[] = [];

  queue(resp: AIResponse): this {
    this.queueResponses.push({ resp });
    return this;
  }

  script(requestId: string, resp: AIResponse): this {
    this.scripted.set(requestId, { id: requestId, resp });
    return this;
  }

  match(re: RegExp, resp: AIResponse): this {
    this.matchers.push({ re, resp });
    return this;
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    this.calls.push(req);
    if (req.requestId && this.scripted.has(req.requestId)) {
      return this.scripted.get(req.requestId)!.resp;
    }
    const text = req.messages.map((m) => m.content).join("\n");
    for (const m of this.matchers) {
      if (m.re.test(text)) return m.resp;
    }
    const q = this.queueResponses.shift();
    if (q) return q.resp;
    throw new Error(
      "MockAIClient: no scripted response available. Last request: " +
        JSON.stringify(req, null, 2),
    );
  }
}
