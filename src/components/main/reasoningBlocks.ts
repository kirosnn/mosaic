import { parseAndWrapMarkdown, type MarkdownSegment } from "../../utils/markdown";
import { wrapText } from "./wrapText";
import type { ReasoningRenderBlock } from "./reasoningPanelModel";

function stripMarkdown(text: string): string {
  return text
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function buildReasoningRenderBlocks(
  content: string,
  maxWidth: number,
  messageKey: string,
): ReasoningRenderBlock[] {
  const blocks = parseAndWrapMarkdown(content, Math.max(1, maxWidth));
  const items: ReasoningRenderBlock[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!;

    if (block.type === "line" && block.wrappedLines) {
      for (let lineIndex = 0; lineIndex < block.wrappedLines.length; lineIndex++) {
        const wrappedLine = block.wrappedLines[lineIndex];
        const text = wrappedLine?.text || "";
        const stripped = stripMarkdown(text.replace(/\\n/g, ""));
        if (!stripped && !text.includes("\n")) continue;

        items.push({
          key: `${messageKey}-reasoning-line-${blockIndex}-${lineIndex}`,
          type: "line",
          content: stripped || " ",
          visualLines: 1,
        });
      }
      continue;
    }

    if (block.type === "code" && block.codeLines) {
      items.push({
        key: `${messageKey}-reasoning-code-${blockIndex}`,
        type: "code",
        codeLanguage: block.language,
        codeContent: block.codeLines.join("\n"),
        codeHeight: Math.max(1, block.codeLines.length),
        visualLines: Math.max(1, block.codeLines.length),
      });
    }
  }

  if (items.length === 0 && content.trim().length > 0) {
    const wrapped = wrapText(content.trim(), Math.max(1, maxWidth));
    items.push({
      key: `${messageKey}-reasoning-raw`,
      type: "raw",
      content: wrapped.join("\n"),
      visualLines: Math.max(1, wrapped.length),
    });
  }

  return items;
}
