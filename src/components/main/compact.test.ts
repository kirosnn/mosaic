import { describe, expect, test } from "bun:test";
import type { Message } from "./types";
import {
  shouldAutoCompact,
  estimateTotalTokens,
  compactMessagesForUi,
  buildSummary,
  appendContextFiles
} from "../Main";

const makeId = () => "id";

describe("auto compact threshold", () => {
  test("triggers at 95% of max context tokens", () => {
    expect(shouldAutoCompact(949, 1000)).toBe(false);
    expect(shouldAutoCompact(950, 1000)).toBe(true);
    expect(shouldAutoCompact(1000, 1000)).toBe(true);
  });

  test("ignores invalid max context tokens", () => {
    expect(shouldAutoCompact(100, 0)).toBe(false);
    expect(shouldAutoCompact(100, -1)).toBe(false);
    expect(shouldAutoCompact(100, Number.NaN)).toBe(false);
  });
});

describe("compactMessagesForUi summaryOnly", () => {
  test("keeps only summary and context files", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "A" },
      { id: "2", role: "assistant", content: "B" },
      {
        id: "3",
        role: "tool",
        content: "read",
        toolName: "read",
        toolArgs: { path: "src/app.ts" },
        success: true
      }
    ];

    const result = compactMessagesForUi(messages, "sys", 200, makeId, true);
    expect(result.messages.length).toBe(1);
    const summary = result.messages[0]!.content;
    expect(summary).toContain("Résumé de conversation (compact):");
    expect(summary).toContain("Fichiers conservés après compaction:");
    expect(summary).toContain("src/app.ts");
  });
});

describe("summary helpers", () => {
  test("summary includes all messages when requested", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "there" },
      { id: "3", role: "tool", content: "done", toolName: "grep", toolArgs: { pattern: "foo" }, success: true }
    ];
    const summary = buildSummary(messages, 200);
    expect(summary).toContain("user: hello");
    expect(summary).toContain("assistant: there");
    expect(summary).toContain("tool grep:");
  });

  test("appends file list to summary", () => {
    const summary = buildSummary([{ id: "1", role: "user", content: "x" }], 200);
    const combined = appendContextFiles(summary, ["a.ts", "b.ts"], 200);
    expect(combined).toContain("Fichiers conservés après compaction:");
    expect(combined).toContain("a.ts");
    expect(combined).toContain("b.ts");
  });
});

describe("token estimation", () => {
  test("total tokens include system prompt", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "aaaa" }
    ];
    const total = estimateTotalTokens(messages, "system");
    expect(total).toBeGreaterThan(0);
  });
});