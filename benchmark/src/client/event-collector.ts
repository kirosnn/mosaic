import {
  RateLimitError,
} from "../types.js";
import type {
  StreamEvent,
  CollectorResult,
  ToolCall,
  ApprovalRequest,
  QuestionRequest,
  ApprovalPolicy,
  LatencyMetrics,
} from "../types.js";
import { CONFIG } from "../config.js";
import { parseNDJSON } from "./stream-parser.js";

const RATE_LIMIT_PATTERNS = ["rate limit", "too many requests", "quota", "throttle", "429"];

export class EventCollector {
  private toolCalls: ToolCall[] = [];
  private textChunks: string[] = [];
  private events: StreamEvent[] = [];
  private approvalRequests: ApprovalRequest[] = [];
  private questionRequests: QuestionRequest[] = [];
  private timedOut = false;
  private error?: string;
  private pendingTools = new Map<string, ToolCall>();
  private streamStart = 0;
  private firstTokenTime = 0;
  private lastTokenTime = 0;
  private totalChars = 0;

  async collect(
    response: Response,
    approvalPolicy: ApprovalPolicy,
    timeout: number,
  ): Promise<CollectorResult> {
    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.streamStart = performance.now();
    const timeoutId = setTimeout(async () => {
      this.timedOut = true;
      reader.cancel();
      try {
        await fetch(`${CONFIG.mosaicUrl}/api/stop`, { method: "POST" });
      } catch {}
    }, timeout);

    try {
      for await (const event of parseNDJSON(reader)) {
        this.events.push(event);
        await this.handleEvent(event, approvalPolicy);
        if (event.type === "finish" || event.type === "stopped" || event.type === "error") {
          break;
        }
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      if (!this.timedOut) {
        this.error = String(err);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const latency: LatencyMetrics = {
      ttftMs: this.firstTokenTime > 0 ? this.firstTokenTime - this.streamStart : 0,
      totalChars: this.totalChars,
      streamDurationMs: this.lastTokenTime > 0 && this.firstTokenTime > 0
        ? this.lastTokenTime - this.firstTokenTime
        : 0,
    };

    return {
      toolCalls: this.toolCalls,
      textOutput: this.textChunks.join(""),
      events: this.events,
      approvalRequests: this.approvalRequests,
      questionRequests: this.questionRequests,
      timedOut: this.timedOut,
      error: this.error,
      latency,
    };
  }

  private async handleEvent(event: StreamEvent, approvalPolicy: ApprovalPolicy): Promise<void> {
    switch (event.type) {
      case "ping":
        break;

      case "text-delta": {
        const now = performance.now();
        if (!this.firstTokenTime) this.firstTokenTime = now;
        this.lastTokenTime = now;
        this.totalChars += event.content.length;
        this.textChunks.push(event.content);
        break;
      }

      case "tool-call-end": {
        const tc: ToolCall = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        };
        this.pendingTools.set(event.toolCallId, tc);
        this.toolCalls.push(tc);
        break;
      }

      case "tool-result": {
        const tc = this.pendingTools.get(event.toolCallId);
        if (tc) {
          tc.result = event.result;
          this.pendingTools.delete(event.toolCallId);
        }
        break;
      }

      case "approval": {
        const req = event.request as ApprovalRequest;
        this.approvalRequests.push(req);
        const approved = approvalPolicy === "approve-all";
        try {
          await fetch(`${CONFIG.mosaicUrl}/api/approval/respond`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved }),
          });
        } catch {}
        break;
      }

      case "question": {
        const req = event.request as QuestionRequest;
        this.questionRequests.push(req);
        try {
          await fetch(`${CONFIG.mosaicUrl}/api/question/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: 0 }),
          });
        } catch {}
        break;
      }

      case "error": {
        const msg = (event as { error: string }).error;
        const lower = msg.toLowerCase();
        if (RATE_LIMIT_PATTERNS.some((p) => lower.includes(p))) {
          throw new RateLimitError(msg);
        }
        this.error = msg;
        break;
      }
    }
  }
}
