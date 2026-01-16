import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { renderMarkdownSegment, parseAndWrapMarkdown } from "../../utils/markdown";
import { getToolParagraphIndent, getToolWrapTarget, getToolWrapWidth } from "../../utils/toolFormatting";
import { subscribeQuestion, answerQuestion, type QuestionRequest } from "../../utils/questionBridge";
import { subscribeApproval, respondApproval, type ApprovalRequest } from "../../utils/approvalBridge";
import { CustomInput } from "../CustomInput";
import type { Message } from "./types";
import { wrapText } from "./wrapText";
import { QuestionPanel } from "./QuestionPanel";
import { ApprovalPanel } from "./ApprovalPanel";
import { ThinkingIndicatorBlock, getBottomReservedLinesForInputBar, getInputBarBaseLines, getInputAreaTotalLines, formatElapsedTime } from "./ThinkingIndicator";

interface ChatPageProps {
  messages: Message[];
  isProcessing: boolean;
  processingStartTime: number | null;
  currentTokens: number;
  scrollOffset: number;
  terminalHeight: number;
  terminalWidth: number;
  pasteRequestId: number;
  shortcutsOpen: boolean;
  onSubmit: (value: string, meta?: import("../CustomInput").InputSubmitMeta) => void;
}

export function ChatPage({
  messages,
  isProcessing,
  processingStartTime,
  currentTokens,
  scrollOffset,
  terminalHeight,
  terminalWidth,
  pasteRequestId,
  shortcutsOpen,
  onSubmit,
}: ChatPageProps) {
  const maxWidth = Math.max(20, terminalWidth - 6);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);

  useEffect(() => {
    return subscribeQuestion(setQuestionRequest);
  }, []);

  useEffect(() => {
    return subscribeApproval(setApprovalRequest);
  }, []);

  const bottomReservedLines = getBottomReservedLinesForInputBar({
    isProcessing,
    hasQuestion: Boolean(questionRequest) || Boolean(approvalRequest),
  });
  const viewportHeight = Math.max(5, terminalHeight - (bottomReservedLines + 2));

  interface RenderItem {
    key: string;
    type: 'line' | 'question' | 'approval' | 'blend';
    content?: string;
    role: "user" | "assistant" | "tool" | "slash";
    isFirst: boolean;
    indent?: number;
    segments?: import("../../utils/markdown").MarkdownSegment[];
    success?: boolean;
    isError?: boolean;
    isSpacer?: boolean;
    questionRequest?: QuestionRequest;
    approvalRequest?: ApprovalRequest;
    visualLines: number;
    blendDuration?: number;
    blendWord?: string;
  }

  const allItems: RenderItem[] = [];

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    const messageKey = message.id || `m-${messageIndex}`;
    const messageRole = message.displayRole ?? message.role;
    if (messageRole === 'assistant') {
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
              role: messageRole,
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
      const messageText = message.displayContent ?? message.content;
      const paragraphs = messageText.split('\n');
      let isFirstContent = true;

      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i] ?? '';
        if (paragraph === '') {
          allItems.push({
            key: `${messageKey}-paragraph-${i}-empty`,
            type: 'line',
            content: '',
            role: messageRole,
            isFirst: false,
            indent: messageRole === 'tool' ? getToolParagraphIndent(i) : 0,
            success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
            isSpacer: messageRole !== 'tool' && messageRole !== 'slash',
            visualLines: 1
          });
        } else {
          const indent = messageRole === 'tool' ? getToolParagraphIndent(i) : 0;
          const wrapTarget = messageRole === 'tool' ? getToolWrapTarget(paragraph, i) : paragraph;
          const wrapWidth = messageRole === 'tool' ? getToolWrapWidth(maxWidth, i) : maxWidth;
          const wrappedLines = wrapText(wrapTarget, wrapWidth);
          for (let j = 0; j < wrappedLines.length; j++) {
            allItems.push({
              key: `${messageKey}-paragraph-${i}-line-${j}`,
              type: 'line',
              content: wrappedLines[j] || '',
              role: messageRole,
              isFirst: isFirstContent && i === 0 && j === 0,
              indent,
              success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
              isSpacer: false,
              visualLines: 1
            });
          }
          isFirstContent = false;
        }
      }
    }

    if (message.responseDuration && messageRole === 'assistant' && message.responseDuration > 60000) {
      allItems.push({
        key: `${messageKey}-blend`,
        type: 'blend',
        role: messageRole,
        isFirst: false,
        visualLines: 1,
        blendDuration: message.responseDuration,
        blendWord: message.blendWord || 'Blended'
      });
    }

    allItems.push({
      key: `${messageKey}-spacer`,
      type: 'line',
      content: '',
      role: messageRole,
      isFirst: false,
      isSpacer: true,
      visualLines: 1
    });
  }

  if (questionRequest) {
    allItems.push({
      key: `question-${questionRequest.id}`,
      type: 'question',
      role: 'assistant',
      isFirst: true,
      questionRequest,
      visualLines: Math.max(6, 5 + questionRequest.options.length),
    });
    allItems.push({
      key: `question-${questionRequest.id}-spacer`,
      type: 'line',
      content: '',
      role: 'assistant',
      isFirst: false,
      isSpacer: true,
      visualLines: 1,
    });
  }

  if (approvalRequest) {
    const previewLines = approvalRequest.preview.content.split('\n').length;
    allItems.push({
      key: `approval-${approvalRequest.id}`,
      type: 'approval',
      role: 'assistant',
      isFirst: true,
      approvalRequest,
      visualLines: Math.max(8, 6 + Math.min(previewLines, 15)),
    });
    allItems.push({
      key: `approval-${approvalRequest.id}-spacer`,
      type: 'line',
      content: '',
      role: 'assistant',
      isFirst: false,
      isSpacer: true,
      visualLines: 1,
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
      <box flexGrow={1} flexDirection="column" width="100%" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={bottomReservedLines}>
        {visibleLines.map((item) => {
          if (item.type === 'question') {
            const req = item.questionRequest;
            if (!req) return null;
            return (
              <box key={item.key} flexDirection="column" width="100%">
                <QuestionPanel
                  request={req}
                  disabled={shortcutsOpen}
                  onAnswer={(index, customText) => answerQuestion(index, customText)}
                />
              </box>
            );
          }

          if (item.type === 'approval') {
            const req = item.approvalRequest;
            if (!req) return null;
            return (
              <box key={item.key} flexDirection="column" width="100%">
                <ApprovalPanel
                  request={req}
                  disabled={shortcutsOpen}
                  onRespond={(approved, customResponse) => respondApproval(approved, customResponse)}
                />
              </box>
            );
          }

          if (item.type === 'blend') {
            if (item.blendDuration && item.blendDuration > 60000) {
              const timeStr = formatElapsedTime(item.blendDuration, false);
              return (
                <box key={item.key} flexDirection="row" width="100%">
                  <text attributes={TextAttributes.DIM | TextAttributes.ITALIC}>⁘ {item.blendWord} for {timeStr}</text>
                </box>
              );
            }
            return null;
          }

          const showErrorBar = item.role === "assistant" && item.isError && item.isFirst && item.content;
          const showToolBar = item.role === "tool" && item.isSpacer === false;
          const showSlashBar = item.role === "slash" && item.isSpacer === false;
          const showToolBackground = item.role === "tool" && item.isSpacer === false;
          const showSlashBackground = item.role === "slash" && item.isSpacer === false;
          return (
            <box
              key={item.key}
              flexDirection="row"
              width="100%"
              backgroundColor={((item.role === "user" && item.content) || showToolBackground || showSlashBackground || showErrorBar) ? "#1a1a1a" : "transparent"}
              paddingRight={((item.role === "user" && item.content) || showToolBackground || showSlashBackground || showErrorBar) ? 1 : 0}
            >
              {item.role === "user" && item.content && (
                <text fg="#ffca38">▎ </text>
              )}
              {showToolBar && (
                <text fg={item.success ? "#38ff65" : "#ff3838"}>▎ </text>
              )}
              {showSlashBar && (
                <text fg="white">▎ </text>
              )}
              {showErrorBar && (
                <text fg="#ff3838">▎ </text>
              )}
              {item.role === "user" || item.role === "tool" || item.role === "slash" ? (
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
        bottom={1.4}
        left={0}
        right={0}
        flexDirection="column"
        backgroundColor="#1a1a1a"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={0}
        paddingBottom={0}
        flexShrink={0}
        minHeight={getInputBarBaseLines()}
        minWidth="100%"
      >
        <box flexDirection="row" alignItems="center" width="100%" flexGrow={1} minWidth={0}>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <CustomInput
              onSubmit={onSubmit}
              placeholder="Type your message..."
              focused={!isProcessing && !shortcutsOpen && !questionRequest && !approvalRequest}
              pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            />
          </box>
        </box>
      </box>

      <box position="absolute" bottom={0} left={0} right={0} flexDirection="row" paddingLeft={1} paddingRight={1} justifyContent="flex-end">
        <text attributes={TextAttributes.DIM}>ctrl+o to see commands — ctrl+p to view shortcuts</text>
      </box>

      <box position="absolute" bottom={getInputBarBaseLines() + 1} left={0} right={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <ThinkingIndicatorBlock isProcessing={isProcessing} hasQuestion={Boolean(questionRequest) || Boolean(approvalRequest)} startTime={processingStartTime} tokens={currentTokens} />
      </box>
    </box>
  );
}