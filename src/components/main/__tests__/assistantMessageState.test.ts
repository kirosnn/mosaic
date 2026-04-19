import { describe, expect, it } from "bun:test";
import { normalizeAssistantMessage, upsertAssistantMessage } from "../assistantMessageState";
import type { Message } from "../types";

describe("assistantMessageState", () => {
  it("defaults reasoning messages to uncollapsed", () => {
    const messages = upsertAssistantMessage([], "assistant-1", {
      thinkingContent: "visible reasoning",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.thinkingCollapsed).toBe(false);
    expect(messages[0]?.thinkingContent).toBe("visible reasoning");
  });

  it("preserves manual toggle state across streaming updates", () => {
    let messages = upsertAssistantMessage([], "assistant-1", {
      thinkingContent: "step one",
    });

    messages = messages.map((message) => (
      message.id === "assistant-1"
        ? { ...message, thinkingCollapsed: false }
        : message
    ));

    messages = upsertAssistantMessage(messages, "assistant-1", {
      thinkingContent: "step one\nstep two",
      content: "final answer",
    });

    expect(messages[0]?.thinkingCollapsed).toBe(false);
    expect(messages[0]?.thinkingContent).toContain("step two");
    expect(messages[0]?.content).toBe("final answer");
  });

  it("normalizes restored assistant messages with reasoning", () => {
    const restoredMessage: Message = {
      id: "assistant-1",
      role: "assistant",
      content: "final answer",
      thinkingContent: "restored reasoning",
    };

    const normalized = normalizeAssistantMessage(restoredMessage);

    expect(normalized.thinkingCollapsed).toBe(false);
    expect(normalized.thinkingContent).toBe("restored reasoning");
  });
});
