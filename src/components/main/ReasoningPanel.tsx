import { useEffect, useState, useMemo } from "react";
import { RGBA, SyntaxStyle, TextAttributes } from "@opentui/core";
import { getVisibleReasoningBlocks, REASONING_PANEL_HEADER, type ReasoningRenderBlock } from "./reasoningPanelModel";

const CODE_SYNTAX_STYLE = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
  string: { fg: RGBA.fromHex("#A5D6FF") },
  comment: { fg: RGBA.fromHex("#8B949E"), italic: true },
  number: { fg: RGBA.fromHex("#79C0FF") },
  function: { fg: RGBA.fromHex("#D2A8FF") },
  default: { fg: RGBA.fromHex("#D0D0D0") },
});

const CODE_FILETYPE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  md: "markdown",
  markdown: "markdown",
};

function normalizeCodeFiletype(language?: string): string {
  const key = (language || "").trim().toLowerCase();
  return CODE_FILETYPE_MAP[key] || "javascript";
}

interface ReasoningPanelProps {
  blocks: ReasoningRenderBlock[];
  collapsed: boolean;
  onToggle?: () => void;
  isStreaming?: boolean;
}

export function ReasoningPanel({ blocks, collapsed, onToggle, isStreaming }: ReasoningPanelProps) {
  const visibleBlocks = getVisibleReasoningBlocks(blocks, collapsed);

  const headerLabel = collapsed ? "Expand thoughts" : REASONING_PANEL_HEADER;

  return (
    <box flexDirection="column" width="100%" marginBottom={1}>
      <box
        flexDirection="row"
        width="100%"
        onMouseDown={onToggle}
        paddingLeft={2}
        paddingY={0}
      >
        <text fg="#666666">
          {headerLabel}
        </text>
      </box>

      {visibleBlocks.length > 0 && (
        <box flexDirection="column" width="100%" paddingTop={0}>
          {visibleBlocks.map((block, index) => {
            const isLast = index === visibleBlocks.length - 1;

            return (
              <box key={block.key} flexDirection="column" width="100%" paddingLeft={0}>
                <box flexDirection="row" width="100%">
                  {block.type === "code" ? (
                    <code
                      content={block.codeContent}
                      filetype={normalizeCodeFiletype(block.codeLanguage)}
                      syntaxStyle={CODE_SYNTAX_STYLE}
                      width="100%"
                      height={block.codeHeight}
                      wrapMode="none"
                    />
                  ) : (
                    <text fg="#999999" attributes={TextAttributes.ITALIC}>
                      {block.content}
                    </text>
                  )}
                </box>
                {!isLast && (
                  <box height={1} width="100%" />
                )}
              </box>
            );
          })}
        </box>
      )}
    </box>
  );
}
