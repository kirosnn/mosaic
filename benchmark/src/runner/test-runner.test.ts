import { describe, expect, it } from "bun:test";
import type { BenchmarkMessage, CollectorResult, TestCase } from "../types.js";
import { outputContains } from "../scoring/rules.js";
import { TestRunner } from "./test-runner.js";

function collected(textOutput: string): CollectorResult {
  return {
    toolCalls: [],
    textOutput,
    events: [{ type: "text-delta", content: textOutput }, { type: "finish", finishReason: "stop" }],
    approvalRequests: [],
    questionRequests: [],
    timedOut: false,
    latency: { ttftMs: 1, totalChars: textOutput.length, streamDurationMs: 1 },
  };
}

describe("multi-turn benchmark runner", () => {
  it("passes prior dialogue to each follow-up", async () => {
    const histories: BenchmarkMessage[][] = [];
    const client = {
      setWorkspace: async () => {},
      setApprovals: async () => {},
      stop: async () => {},
      sendMessage: async (prompt: string, _policy: string, _timeout: number, history: BenchmarkMessage[]) => {
        histories.push([...history]);
        return collected(prompt === "first" ? "first answer" : "final answer");
      },
    };
    const workspaceManager = {
      create: () => ({ path: "workspace", benchSecret: "secret" }),
    };
    const test: TestCase = {
      id: "multi-turn:test",
      suite: "multi-turn",
      name: "test",
      prompt: "two turns",
      fixture: "EMPTY_PROJECT",
      turns: [{ prompt: "first" }, { prompt: "second" }],
      rules: [outputContains("final answer")],
    };

    const runner = new TestRunner(client as any, workspaceManager as any, false);
    const result = await runner.run(test);

    expect(result.percentage).toBe(100);
    expect(histories[0]).toEqual([]);
    expect(histories[1]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "first answer" },
    ]);
  });
});
