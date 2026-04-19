import type { MarkdownSegment } from "../../utils/markdown";

export const REASONING_PANEL_HEADER = "Thinking";

export type ReasoningRenderBlock =
  | {
      type: "line";
      key: string;
      content: string;
      segments?: MarkdownSegment[];
      visualLines: 1;
    }
  | {
      type: "code";
      key: string;
      codeLanguage?: string;
      codeContent: string;
      codeHeight: number;
      visualLines: number;
    }
  | {
      type: "raw";
      key: string;
      content: string;
      visualLines: number;
    };

export function getReasoningPanelVisualLines(
  blocks: ReasoningRenderBlock[],
  collapsed: boolean,
): number {
  if (collapsed) {
    return 2; // Header + bottom spacer
  }
  if (blocks.length === 0) {
    return 2; // Header + bottom spacer
  }
  // Each block has 1 line, plus a spacer line between blocks, plus the header, plus the bottom spacer
  return (blocks.length * 2 - 1) + 1 + 1;
}

export function getVisibleReasoningBlocks(
  blocks: ReasoningRenderBlock[],
  collapsed: boolean,
): ReasoningRenderBlock[] {
  return collapsed ? [] : blocks;
}
