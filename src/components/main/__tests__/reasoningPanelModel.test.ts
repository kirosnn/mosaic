import { describe, expect, it } from "bun:test";
import {
  getReasoningPanelVisualLines,
  getVisibleReasoningBlocks,
  REASONING_PANEL_HEADER,
  type ReasoningRenderBlock,
} from "../reasoningPanelModel";

const reasoningBlocks: ReasoningRenderBlock[] = [
  {
    type: "line",
    key: "line-1",
    content: "first step",
    visualLines: 1,
  },
  {
    type: "code",
    key: "code-1",
    codeContent: "const x = 1;",
    codeHeight: 1,
    visualLines: 1,
  },
];

describe("reasoningPanelModel", () => {
  it("uses the exact compact header label", () => {
    expect(REASONING_PANEL_HEADER).toBe("Thinking");
  });

  it("hides all reasoning blocks when collapsed", () => {
    expect(getVisibleReasoningBlocks(reasoningBlocks, true)).toEqual([]);
    expect(getReasoningPanelVisualLines(reasoningBlocks, true)).toBe(2);
  });

  it("keeps full reasoning blocks available when expanded", () => {
    expect(getVisibleReasoningBlocks(reasoningBlocks, false)).toEqual(
      reasoningBlocks,
    );
    expect(getReasoningPanelVisualLines(reasoningBlocks, false)).toBe(5);
  });
});
