import { describe, expect, it } from "bun:test";
import { buildReasoningRenderBlocks } from "../reasoningBlocks";
import { getReasoningPanelVisualLines } from "../reasoningPanelModel";

describe("reasoningBlocks", () => {
  it("builds blocks for simple text", () => {
    const blocks = buildReasoningRenderBlocks("Hello world", 80, "msg1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("line");
    if (blocks[0].type === "line") {
      expect(blocks[0].content).toBe("Hello world");
    }
  });

  it("builds blocks for markdown text", () => {
    const blocks = buildReasoningRenderBlocks(
      "I am **thinking** about `code`",
      80,
      "msg1",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("line");
    if (blocks[0].type === "line") {
      expect(blocks[0].segments).toBeDefined();
      expect(blocks[0].segments).toHaveLength(4);
    }
  });

  it("builds blocks for code blocks", () => {
    const blocks = buildReasoningRenderBlocks(
      "Here is code:\n```js\nconsole.log(1);\n```",
      80,
      "msg1",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("line");
    expect(blocks[1].type).toBe("code");
  });

  it("handles multiple lines correctly", () => {
    const blocks = buildReasoningRenderBlocks("Line 1\n\nLine 2", 80, "msg1");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("line");
    expect(blocks[1].type).toBe("line");
  });

  it("uses raw fallback when content would otherwise be empty", () => {
    const blocks = buildReasoningRenderBlocks("   ", 80, "msg1");
    expect(blocks).toHaveLength(0);

    const blocksWithContent = buildReasoningRenderBlocks(".", 80, "msg1");
    expect(blocksWithContent.length).toBeGreaterThan(0);
  });

  it("calculates visual lines correctly for collapsed and expanded states", () => {
    const blocks = buildReasoningRenderBlocks("Line 1\nLine 2", 80, "msg1");

    const collapsedLines = getReasoningPanelVisualLines(blocks, true);
    expect(collapsedLines).toBe(2);

    const expandedLines = getReasoningPanelVisualLines(blocks, false);
    expect(expandedLines).toBe(blocks.length * 2 - 1 + 1 + 1);
  });
});
