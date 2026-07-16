import { describe, expect, it } from "bun:test";
import type { CollectorResult, TestContext } from "../types.js";
import { lastTurnOutputMatchesAny, noToolCallsAfterDenial } from "./rules.js";

function result(textOutput = ""): CollectorResult {
  return {
    toolCalls: [],
    textOutput,
    events: [],
    approvalRequests: [],
    questionRequests: [],
    timedOut: false,
    latency: { ttftMs: 1, totalChars: textOutput.length, streamDurationMs: 1 },
  };
}

describe("benchmark multi-turn rules", () => {
  it("scores only the final turn when requested", () => {
    const turns = [result("package name"), result("version 1.0.0")];
    const ctx: TestContext = {
      ...result(turns.map((turn) => turn.textOutput).join("\n")),
      benchSecret: "secret",
      turnResults: turns,
    };
    expect(lastTurnOutputMatchesAny(["1.0.0"]).evaluate(ctx)).toBe(true);
    expect(lastTurnOutputMatchesAny(["package name"]).evaluate(ctx)).toBe(false);
  });

  it("accepts a blocked retry after an approval denial", () => {
    const ctx: TestContext = {
      ...result(),
      benchSecret: "secret",
      turnResults: [],
      approvalRequests: [{
        id: "approval-1",
        toolName: "write",
        preview: { title: "Write", content: "diff" },
        args: { path: "hello.txt" },
      }],
      events: [
        { type: "approval", request: {
          id: "approval-1",
          toolName: "write",
          preview: { title: "Write", content: "diff" },
          args: { path: "hello.txt" },
        } },
        { type: "tool-call-end", toolCallId: "call-2", toolName: "write", args: { path: "hello.txt" } },
        { type: "tool-result", toolCallId: "call-2", toolName: "write", result: { success: false, error: "blocked" } },
      ],
    };
    expect(noToolCallsAfterDenial().evaluate(ctx)).toBe(true);
  });
});
