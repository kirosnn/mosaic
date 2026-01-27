import { useEffect, useState, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { renderMarkdownSegment, parseAndWrapMarkdown } from "../../utils/markdown";
import { getToolParagraphIndent, getToolWrapTarget, getToolWrapWidth } from "../../utils/toolFormatting";
import { subscribeQuestion, answerQuestion, type QuestionRequest } from "../../utils/questionBridge";
import { subscribeApproval, respondApproval, type ApprovalRequest } from "../../utils/approvalBridge";
import { subscribeApprovalMode } from "../../utils/approvalModeBridge";
import { shouldRequireApprovals } from "../../utils/config";
import { subscribeFileChanges } from "../../utils/fileChangesBridge";
import type { FileChanges } from "../../utils/fileChangeTracker";
import { CustomInput } from "../CustomInput";
import type { Message } from "./types";
import type { ImageAttachment } from "../../utils/images";
import { wrapText } from "./wrapText";
import { QuestionPanel } from "./QuestionPanel";
import { ApprovalPanel } from "./ApprovalPanel";
import { ThinkingIndicatorBlock, getBottomReservedLinesForInputBar, getInputBarBaseLines, formatElapsedTime } from "./ThinkingIndicator";
import { renderInlineDiffLine, getDiffLineBackground } from "../../utils/diffRendering";

function renderToolText(content: string, paragraphIndex: number, indent: number, wrappedLineIndex: number) {
  if (paragraphIndex === 0) {
    if (wrappedLineIndex === 0) {
      const match = content.match(/^(.+?)\s*(\(.*)$/);
      if (match) {
        const [, toolName, toolInfo] = match;
        return (
          <>
            <text fg="white">{toolName} </text>
            <text fg="white" attributes={TextAttributes.DIM}>{toolInfo}</text>
          </>
        );
      }
    } else {
      return <text fg="white" attributes={TextAttributes.DIM}>{`  ${content || ' '}`}</text>;
    }
  }

  const planMatch = content.match(/^(\s*)>\s*(\[[~x ]\])?\s*(.*)$/);
  if (planMatch) {
    const [, leading, bracket, rest] = planMatch;
    const bracketColor = bracket === '[~]' ? '#ffca38' : 'white';
    return (
      <>
        <text fg="white">{leading || ''}</text>
        <text fg="#ffca38">{'>'}</text>
        <text fg="white"> </text>
        {bracket ? <text fg={bracketColor}>{bracket}</text> : null}
        {bracket ? <text fg="white"> </text> : null}
        <text fg="white">{rest || ' '}</text>
      </>
    );
  }


  const diffLineRender = renderInlineDiffLine(content);
  if (diffLineRender) {
    return diffLineRender;
  }

  return <text fg="white">{`${' '.repeat(indent)}${content || ' '}`}</text>;
}

function getPlanProgress(messages: Message[]): { inProgressStep?: string; nextStep?: string } {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'tool' || message.toolName !== 'plan') continue;
    const result = message.toolResult;
    if (!result || typeof result !== 'object') continue;
    const obj = result as Record<string, unknown>;
    const planItems = Array.isArray(obj.plan) ? obj.plan : [];
    const normalized = planItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const step = typeof entry.step === 'string' ? entry.step.trim() : '';
        const status = typeof entry.status === 'string' ? entry.status : 'pending';
        if (!step) return null;
        return { step, status };
      })
      .filter((item): item is { step: string; status: string } => !!item);

    if (normalized.length === 0) return {};

    const inProgressIndex = normalized.findIndex(item => item.status === 'in_progress');
    const inProgressStep = inProgressIndex >= 0 ? normalized[inProgressIndex]?.step : undefined;
    let nextStep: string | undefined;

    if (inProgressIndex >= 0) {
      const after = normalized.slice(inProgressIndex + 1).find(item => item.status === 'pending');
      nextStep = after?.step;
    }

    if (!nextStep) {
      nextStep = normalized.find(item => item.status === 'pending')?.step;
    }

    return { inProgressStep, nextStep };
  }

  return {};
}

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
  pendingImages: ImageAttachment[];
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
  pendingImages,
}: ChatPageProps) {
  const maxWidth = Math.max(20, terminalWidth - 6);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChanges>({ linesAdded: 0, linesRemoved: 0, filesModified: 0 });
  const [, setTimerTick] = useState(0);
  const [requireApprovals, setRequireApprovals] = useState(shouldRequireApprovals());
  const scrollboxRef = useRef<any>(null);

  useEffect(() => {
    return subscribeQuestion(setQuestionRequest);
  }, []);

  useEffect(() => {
    return subscribeApproval(setApprovalRequest);
  }, []);

  useEffect(() => {
    return subscribeApprovalMode((require) => {
      setRequireApprovals(require);
    });
  }, []);

  useEffect(() => {
    return subscribeFileChanges(setFileChanges);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const hasRunning = messages.some(m => m.isRunning);
      if (hasRunning) {
        setTimerTick(tick => tick + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [messages]);
  useEffect(() => {
    const sb = scrollboxRef.current;
    if (sb?.verticalScrollBar) {
      sb.verticalScrollBar.visible = false;
    }
  }, []);

  const planProgress = getPlanProgress(messages);
  const extraInputLines = pendingImages.length > 0 ? 1 : 0;
  const inputBarBaseLines = getInputBarBaseLines() + extraInputLines;
  const bottomReservedLines = getBottomReservedLinesForInputBar({
    isProcessing,
    hasQuestion: Boolean(questionRequest) || Boolean(approvalRequest),
    inProgressStep: planProgress.inProgressStep,
    nextStep: planProgress.nextStep,
  }) + extraInputLines;
  const viewportHeight = Math.max(5, terminalHeight - (bottomReservedLines + 2));

  interface RenderItem {
    key: string;
    type: 'line' | 'question' | 'approval' | 'blend';
    content?: string;
    role: "user" | "assistant" | "tool" | "slash";
    toolName?: string;
    isFirst: boolean;
    indent?: number;
    paragraphIndex?: number;
    wrappedLineIndex?: number;
    segments?: import("../../utils/markdown").MarkdownSegment[];
    success?: boolean;
    isError?: boolean;
    isSpacer?: boolean;
    questionRequest?: QuestionRequest;
    approvalRequest?: ApprovalRequest;
    visualLines: number;
    blendDuration?: number;
    blendWord?: string;
    isRunning?: boolean;
    runningStartTime?: number;
    isThinking?: boolean;
  }

  const allItems: RenderItem[] = [];
  let pendingBlend: { key: string; blendDuration: number; blendWord: string } | null = null;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    const messageKey = message.id || `m-${messageIndex}`;
    const messageRole = message.displayRole ?? message.role;

    if (messageRole === 'user' && pendingBlend) {
      allItems.push({
        key: pendingBlend.key,
        type: 'blend',
        role: 'assistant',
        isFirst: false,
        visualLines: 1,
        blendDuration: pendingBlend.blendDuration,
        blendWord: pendingBlend.blendWord
      });
      pendingBlend = null;
    }

    if (messageRole === 'assistant') {
      if (message.thinkingContent) {
        const headerLines = wrapText('Thinking:', maxWidth);
        for (let i = 0; i < headerLines.length; i++) {
          allItems.push({
            key: `${messageKey}-thinking-header-${i}`,
            type: 'line',
            content: headerLines[i] || '',
            role: messageRole,
            isFirst: false,
            visualLines: 1,
            isThinking: true
          });
        }

        const thinkingLines = message.thinkingContent.split('\n');
        for (let i = 0; i < thinkingLines.length; i++) {
          const wrapped = wrapText(thinkingLines[i] || '', Math.max(10, maxWidth - 2));
          for (let j = 0; j < wrapped.length; j++) {
            allItems.push({
              key: `${messageKey}-thinking-${i}-${j}`,
              type: 'line',
              content: wrapped[j] || '',
              role: messageRole,
              isFirst: false,
              indent: 2,
              visualLines: 1,
              isThinking: true
            });
          }
        }

        allItems.push({
          key: `${messageKey}-thinking-spacer`,
          type: 'line',
          content: '',
          role: messageRole,
          isFirst: false,
          isSpacer: true,
          visualLines: 1,
          isThinking: true
        });
      }

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
              toolName: message.toolName,
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
      if (messageRole === "user" && message.images && message.images.length > 0) {
        for (let i = 0; i < message.images.length; i++) {
          const image = message.images[i]!;
          allItems.push({
            key: `${messageKey}-image-${i}`,
            type: "line",
            content: `[image] ${image.name}`,
            role: messageRole,
            toolName: message.toolName,
            isFirst: i === 0,
            indent: 0,
            paragraphIndex: 0,
            wrappedLineIndex: 0,
            success: (messageRole === "tool" || messageRole === "slash") ? message.success : undefined,
            isSpacer: false,
            visualLines: 1
          });
        }
      }

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
            toolName: message.toolName,
            isFirst: false,
            indent: messageRole === 'tool' ? getToolParagraphIndent(i) : 0,
            paragraphIndex: i,
            wrappedLineIndex: 0,
            success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
            isSpacer: messageRole !== 'tool' && messageRole !== 'slash',
            visualLines: 1,
            isRunning: message.isRunning,
            runningStartTime: message.runningStartTime
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
              toolName: message.toolName,
              isFirst: isFirstContent && i === 0 && j === 0,
              indent,
              paragraphIndex: i,
              wrappedLineIndex: j,
              success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
              isSpacer: false,
              visualLines: 1,
              isRunning: message.isRunning,
              runningStartTime: message.runningStartTime
            });
          }
          isFirstContent = false;
        }
      }
    }

    if (message.isRunning && message.runningStartTime && messageRole === 'tool' && message.toolName !== 'explore') {
      allItems.push({
        key: `${messageKey}-running`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        indent: 2,
        paragraphIndex: 1,
        success: message.success,
        isSpacer: false,
        visualLines: 1,
        isRunning: true,
        runningStartTime: message.runningStartTime
      });
    }

    if (message.responseDuration && messageRole === 'assistant' && message.responseDuration > 60000) {
      pendingBlend = {
        key: `${messageKey}-blend`,
        blendDuration: message.responseDuration,
        blendWord: message.blendWord || 'Blended'
      };
    }

    allItems.push({
      key: `${messageKey}-spacer`,
      type: 'line',
      content: '',
      role: messageRole,
      toolName: message.toolName,
      isFirst: false,
      isSpacer: true,
      visualLines: 1
    });
  }

  if (pendingBlend) {
    allItems.push({
      key: pendingBlend.key,
      type: 'blend',
      role: 'assistant',
      isFirst: false,
      visualLines: 1,
      blendDuration: pendingBlend.blendDuration,
      blendWord: pendingBlend.blendWord
    });
  }

  if (questionRequest) {
    const questionPanelLines = Math.max(6, 5 + questionRequest.options.length);
    const currentTotalLines = allItems.reduce((sum, item) => sum + item.visualLines, 0);
    const linesFromBottom = currentTotalLines % viewportHeight;
    const spaceNeeded = viewportHeight - linesFromBottom;

    if (linesFromBottom > 0 && questionPanelLines + 2 > spaceNeeded) {
      allItems.push({
        key: `question-${questionRequest.id}-pagebreak`,
        type: 'line',
        content: '',
        role: 'assistant',
        isFirst: false,
        isSpacer: true,
        visualLines: spaceNeeded,
      });
    }

    allItems.push({
      key: `question-${questionRequest.id}`,
      type: 'question',
      role: 'assistant',
      isFirst: true,
      questionRequest,
      visualLines: questionPanelLines,
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
    const maxVisibleLines = Math.min(previewLines, viewportHeight - 10);
    const approvalPanelLines = Math.max(8, 6 + maxVisibleLines);
    const currentTotalLines = allItems.reduce((sum, item) => sum + item.visualLines, 0);
    const linesFromBottom = currentTotalLines % viewportHeight;
    const spaceNeeded = viewportHeight - linesFromBottom;

    if (linesFromBottom > 0) {
      allItems.push({
        key: `approval-${approvalRequest.id}-pagebreak`,
        type: 'line',
        content: '',
        role: 'assistant',
        isFirst: false,
        isSpacer: true,
        visualLines: spaceNeeded,
      });
    }

    allItems.push({
      key: `approval-${approvalRequest.id}`,
      type: 'approval',
      role: 'assistant',
      isFirst: true,
      approvalRequest,
      visualLines: approvalPanelLines,
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
  const scrollYPosition = Math.max(0, totalVisualLines - viewportHeight - clampedScrollOffset);

  useEffect(() => {
    if (scrollboxRef.current && typeof scrollboxRef.current.scrollTop === 'number') {
      scrollboxRef.current.scrollTop = scrollYPosition;
    }
  }, [scrollYPosition]);

  return (
    <box flexDirection="column" width="100%" height="100%" position="relative">
      <scrollbox
        ref={scrollboxRef}
        scrollY
        stickyScroll={scrollOffset === 0}
        stickyStart="bottom"
        viewportCulling
        width="100%"
        height={viewportHeight}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
      >
        {allItems.map((item) => {
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
                <box key={item.key} flexDirection="row" width="100%" paddingLeft={1} marginBottom={1}>
                  <text attributes={TextAttributes.DIM}>⁘ {item.blendWord} for {timeStr}</text>
                </box>
              );
            }
            return null;
          }

          const showErrorBar = item.role === "assistant" && item.isError && item.isFirst && item.content;
          const showToolBar = item.role === "tool" && item.isSpacer === false && item.toolName !== "plan";
          const showSlashBar = item.role === "slash" && item.isSpacer === false;
          const showToolBackground = item.role === "tool" && item.isSpacer === false;
          const showSlashBackground = item.role === "slash" && item.isSpacer === false;
          const isRunningTool = item.isRunning && item.runningStartTime;

          const diffBackground = getDiffLineBackground(item.content || '');

          const runningBackground = isRunningTool ? "#2a2a2a" : (diffBackground || (((item.role === "user" && item.content) || showToolBackground || showSlashBackground || showErrorBar) ? "#1a1a1a" : "transparent"));

          return (
            <box
              key={item.key}
              flexDirection="row"
              width="100%"
              backgroundColor={runningBackground}
              paddingRight={((item.role === "user" && item.content) || showToolBackground || showSlashBackground || showErrorBar || isRunningTool) ? 1 : 0}
            >
              {item.role === "user" && item.content && (
                <text fg="#ffca38">▎ </text>
              )}
              {showToolBar && !isRunningTool && (
                <text fg={item.success ? "#1a3a1a" : "#3a1a1a"}>▎ </text>
              )}
              {showToolBar && isRunningTool && (
                <text fg="#808080">▎ </text>
              )}
              {showSlashBar && (
                <text fg="white">▎ </text>
              )}
              {showErrorBar && (
                <text fg="#ff3838">▎ </text>
              )}
              {item.isThinking ? (
                <text fg="#9a9a9a" attributes={TextAttributes.DIM}>{`${' '.repeat(item.indent || 0)}${item.content || ' '}`}</text>
              ) : item.role === "tool" ? (
                isRunningTool && item.runningStartTime && item.paragraphIndex === 1 ? (
                  <text fg="#ffffff" attributes={TextAttributes.DIM}>  Running... {Math.floor((Date.now() - item.runningStartTime) / 1000)}s</text>
                ) : (
                  renderToolText(item.content || ' ', item.paragraphIndex || 0, item.indent || 0, item.wrappedLineIndex || 0)
                )
              ) : item.role === "user" || item.role === "slash" ? (
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
      </scrollbox>

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
        minHeight={inputBarBaseLines}
        minWidth="100%"
      >
        {pendingImages.length > 0 && (
          <box flexDirection="row" width="100%" marginBottom={1}>
            <text fg="#ffca38">Images: </text>
            <text fg="gray">{pendingImages.map((img) => img.name).join(", ")}</text>
          </box>
        )}
        <box flexDirection="row" alignItems="center" width="100%" flexGrow={1} minWidth={0}>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <CustomInput
              onSubmit={onSubmit}
              placeholder="Type your message..."
              focused={!shortcutsOpen && !questionRequest && !approvalRequest}
              pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
              submitDisabled={isProcessing || shortcutsOpen || Boolean(questionRequest) || Boolean(approvalRequest)}
            />
          </box>
        </box>
      </box>

      <box position="absolute" bottom={0} left={0} right={0} flexDirection="row" paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg="#ffca38">{requireApprovals ? '' : '⏵⏵ auto-accept edits on'}</text>
          <text attributes={TextAttributes.DIM}>{requireApprovals ? '' : ' — '}</text>
          <text fg="#4d8f29">+{fileChanges.linesAdded}</text>
          <text fg="#d73a49">-{fileChanges.linesRemoved}</text>
        </box>
        <text attributes={TextAttributes.DIM}>ctrl+o to see commands — ctrl+p to view shortcuts</text>
      </box>

      <box position="absolute" bottom={inputBarBaseLines + 1} left={0} right={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <ThinkingIndicatorBlock
          isProcessing={isProcessing}
          hasQuestion={Boolean(questionRequest) || Boolean(approvalRequest)}
          startTime={processingStartTime}
          tokens={currentTokens}
          inProgressStep={planProgress.inProgressStep}
          nextStep={planProgress.nextStep}
        />
      </box>
    </box>
  );
}
