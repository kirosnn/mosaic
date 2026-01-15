import { renderMarkdownSegment, parseAndWrapMarkdown } from "../../utils/markdown";
import { getToolParagraphIndent, getToolWrapTarget, getToolWrapWidth } from "../../utils/toolFormatting";
import { CustomInput } from "../CustomInput";
import type { Message } from "./types";
import { wrapText } from "./wrapText";

interface ChatPageProps {
  messages: Message[];
  isProcessing: boolean;
  scrollOffset: number;
  terminalHeight: number;
  terminalWidth: number;
  pasteRequestId: number;
  shortcutsOpen: boolean;
  onSubmit: (value: string) => void;
}

export function ChatPage({
  messages,
  isProcessing,
  scrollOffset,
  terminalHeight,
  terminalWidth,
  pasteRequestId,
  shortcutsOpen,
  onSubmit,
}: ChatPageProps) {
  const maxWidth = Math.max(20, terminalWidth - 6);
  const viewportHeight = Math.max(5, terminalHeight - 5);

  interface RenderItem {
    key: string;
    type: 'line';
    content?: string;
    role: "user" | "assistant" | "tool";
    isFirst: boolean;
    indent?: number;
    segments?: import("../../utils/markdown").MarkdownSegment[];
    success?: boolean;
    isError?: boolean;
    isSpacer?: boolean;
    visualLines: number;
  }

  const allItems: RenderItem[] = [];

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    const messageKey = message.id || `m-${messageIndex}`;
    if (message.role === 'assistant') {
      const blocks = parseAndWrapMarkdown(message.content, maxWidth);
      let isFirstContent = true;

      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex]!;
        if (block.type !== 'line' || !block.wrappedLines) continue;

        for (let j = 0; j < block.wrappedLines.length; j++) {
          const wrapped = block.wrappedLines[j];
          if (wrapped) {
            allItems.push({
              key: `${messageKey}-line-${blockIndex}-${j}`,
              type: 'line',
              content: wrapped.text || '',
              role: message.role,
              isFirst: isFirstContent && j === 0,
              segments: wrapped.segments,
              isError: message.isError,
              visualLines: 1
            });
            if (wrapped.text && wrapped.text.trim()) {
              isFirstContent = false;
            }
          }
        }
      }
    } else {
      const paragraphs = message.content.split('\n');
      let isFirstContent = true;

      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i] ?? '';
        if (paragraph === '') {
          allItems.push({
            key: `${messageKey}-paragraph-${i}-empty`,
            type: 'line',
            content: '',
            role: message.role,
            isFirst: false,
            indent: message.role === 'tool' ? getToolParagraphIndent(i) : 0,
            success: message.role === 'tool' ? message.success : undefined,
            isSpacer: true,
            visualLines: 1
          });
        } else {
          const indent = message.role === 'tool' ? getToolParagraphIndent(i) : 0;
          const wrapTarget = message.role === 'tool' ? getToolWrapTarget(paragraph, i) : paragraph;
          const wrapWidth = message.role === 'tool' ? getToolWrapWidth(maxWidth, i) : maxWidth;
          const wrappedLines = wrapText(wrapTarget, wrapWidth);
          for (let j = 0; j < wrappedLines.length; j++) {
            allItems.push({
              key: `${messageKey}-paragraph-${i}-line-${j}`,
              type: 'line',
              content: wrappedLines[j] || '',
              role: message.role,
              isFirst: isFirstContent && i === 0 && j === 0,
              indent,
              success: message.role === 'tool' ? message.success : undefined,
              visualLines: 1
            });
          }
          isFirstContent = false;
        }
      }
    }

    allItems.push({
      key: `${messageKey}-spacer`,
      type: 'line',
      content: '',
      role: message.role,
      isFirst: false,
      isSpacer: true,
      visualLines: 1
    });
  }

  if (isProcessing) {
    allItems.push({
      key: 'thinking',
      type: 'line',
      content: 'Thinking...',
      role: 'assistant',
      isFirst: true,
      visualLines: 1
    });
  }

  const totalVisualLines = allItems.reduce((sum, item) => sum + item.visualLines, 0);
  const maxScrollOffset = Math.max(0, totalVisualLines - viewportHeight);
  const clampedScrollOffset = Math.max(0, Math.min(scrollOffset, maxScrollOffset));

  let visibleLines: RenderItem[] = [];

  if (allItems.length === 0) {
    visibleLines = [];
  } else {
    const targetEndLine = totalVisualLines - clampedScrollOffset;
    const targetStartLine = Math.max(0, targetEndLine - viewportHeight);

    let currentLine = 0;
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i]!;
      const itemEndLine = currentLine + item.visualLines;

      if (startIdx === -1 && itemEndLine > targetStartLine) {
        startIdx = i;
      }

      if (endIdx === -1 && itemEndLine >= targetEndLine) {
        endIdx = i + 1;
        break;
      }

      currentLine = itemEndLine;
    }

    if (startIdx === -1) startIdx = 0;
    if (endIdx === -1) endIdx = allItems.length;

    visibleLines = allItems.slice(startIdx, endIdx);
  }

  return (
    <box flexDirection="column" width="100%" height="100%" position="relative">
      <box flexGrow={1} flexDirection="column" width="100%" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={3}>
        {visibleLines.map((item) => {
          const showErrorBar = item.role === "assistant" && item.isError && item.isFirst && item.content;
          const showToolBar = item.role === "tool" && !item.isSpacer;
          const showToolBackground = item.role === "tool" && !item.isSpacer;
          return (
            <box
              key={item.key}
              flexDirection="row"
              width="100%"
              backgroundColor={((item.role === "user" && item.content) || showToolBackground || showErrorBar) ? "#1a1a1a" : "transparent"}
              paddingRight={((item.role === "user" && item.content) || showToolBackground || showErrorBar) ? 1 : 0}
            >
              {item.role === "user" && item.content && (
                <text fg="#ffca38">▎ </text>
              )}
              {showToolBar && (
                <text fg={item.success ? "#38ff65" : "#ff3838"}>▎ </text>
              )}
              {showErrorBar && (
                <text fg="#ff3838">▎ </text>
              )}
              {item.role === "user" || item.role === "tool" ? (
                <text fg="white">{`${' '.repeat(item.indent || 0)}${item.content || ' '}`}</text>
              ) : item.segments && item.segments.length > 0 ? (
                <>
                  {item.segments.map((segment, segIndex) => renderMarkdownSegment(segment, segIndex))}
                </>
              ) : (
                <text fg={item.isError ? "#ff3838" : "white"}>{item.content || ' '}</text>
              )}
            </box>
          );
        })}
      </box>

      <box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        flexDirection="column"
        backgroundColor="#1a1a1a"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        flexShrink={0}
        minHeight={3}
        minWidth="100%"
      >
        <box flexDirection="row" alignItems="center" width="100%" flexGrow={1} minWidth={0}>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <CustomInput
              onSubmit={onSubmit}
              placeholder="Type your message..."
              focused={!isProcessing && !shortcutsOpen}
              pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            />
          </box>
        </box>
      </box>
    </box>
  );
}
