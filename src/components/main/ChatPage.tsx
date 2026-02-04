import { useEffect, useState, useRef } from "react";
import { TextAttributes, SyntaxStyle, RGBA, type KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { renderMarkdownSegment, parseAndWrapMarkdown } from "../../utils/markdown";
import { getToolParagraphIndent, getToolWrapTarget, getToolWrapWidth } from "../../utils/toolFormatting";
import { subscribeQuestion, answerQuestion, type QuestionRequest } from "../../utils/questionBridge";
import { subscribeApproval, respondApproval, type ApprovalRequest } from "../../utils/approvalBridge";
import { subscribeApprovalMode } from "../../utils/approvalModeBridge";
import { shouldRequireApprovals } from "../../utils/config";
import { subscribeFileChanges } from "../../utils/fileChangesBridge";
import type { FileChanges } from "../../utils/fileChangeTracker";
import { notifyNotification } from "../../utils/notificationBridge";
import { CustomInput } from "../CustomInput";
import type { Message } from "./types";
import type { ImageAttachment } from "../../utils/images";
import { wrapText } from "./wrapText";
import { QuestionPanel } from "./QuestionPanel";
import { ApprovalPanel } from "./ApprovalPanel";
import { ThinkingIndicatorBlock, getBottomReservedLinesForInputBar, getInputBarBaseLines, formatElapsedTime } from "./ThinkingIndicator";
import { renderInlineDiffLine, getDiffLineBackground } from "../../utils/diffRendering";
import { parseToolHeader } from "../../utils/toolFormatting";
import { getNativeMcpToolName } from "../../mcp/types";

const CODE_SYNTAX_STYLE = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
  string: { fg: RGBA.fromHex("#A5D6FF") },
  comment: { fg: RGBA.fromHex("#8B949E"), italic: true },
  number: { fg: RGBA.fromHex("#79C0FF") },
  function: { fg: RGBA.fromHex("#D2A8FF") },
  default: { fg: RGBA.fromHex("#E6EDF3") },
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

const TABLE_HEADER_BG = "#2a2a2a";
const TABLE_BODY_BG = "#1f1f1f";

function normalizeCodeFiletype(language?: string): string {
  const key = (language || "").trim().toLowerCase();
  return CODE_FILETYPE_MAP[key] || "javascript";
}

function renderToolText(content: string, paragraphIndex: number, indent: number, wrappedLineIndex: number, toolName?: string, planStatus?: 'pending' | 'in_progress' | 'completed') {
  if (toolName === 'plan') {
    const leftPad = paragraphIndex === 0 ? 3 : indent + 1;
    const padText = ' '.repeat(leftPad);
    const trimmed = content || '';
    const match = trimmed.match(/^\[(.)\]\s*(.*)$/);
    if (match) {
      const marker = match[1] || ' ';
      const rest = match[2] || '';
      const resolvedStatus = planStatus
        ?? (marker === '~' || marker === '●' ? 'in_progress' : (marker === 'x' || marker === '✓' ? 'completed' : 'pending'));
      const isInProgress = resolvedStatus === 'in_progress';
      const isCompleted = resolvedStatus === 'completed';
      const markerColor = isInProgress ? '#ffca38' : '#9a9a9a';
      const markerChar = isInProgress ? '●' : (isCompleted ? '✓' : ' ');
      return (
        <box flexDirection="row">
          <text attributes={TextAttributes.DIM}>{padText}</text>
          <text attributes={TextAttributes.DIM}>[</text>
          <text fg={markerColor}>{markerChar}</text>
          <text attributes={TextAttributes.DIM}>]</text>
          <text attributes={TextAttributes.DIM}>{rest ? ` ${rest}` : ''}</text>
        </box>
      );
    }
    return <text attributes={TextAttributes.DIM}>{`${padText}${trimmed || ' '}`}</text>;
  }

  if (paragraphIndex === 0) {
    if (wrappedLineIndex === 0) {
      const match = content.match(/^(.+?)\s*(\(.*)$/);
      if (match) {
        const [, toolName, toolInfo] = match;
        return (
          <box flexDirection="row">
            <text fg="white">{toolName} </text>
            <text fg="white" attributes={TextAttributes.DIM}>{toolInfo}</text>
          </box>
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
      <box flexDirection="row">
        <text fg="white">{leading || ''}</text>
        <text fg="#ffca38">{'>'}</text>
        <text fg="white"> </text>
        {bracket ? <text fg={bracketColor}>{bracket}</text> : null}
        {bracket ? <text fg="white"> </text> : null}
        <text fg="white">{rest || ' '}</text>
      </box>
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
  onCopyMessage?: (text: string) => void;
  pendingImages: ImageAttachment[];
  reviewPanel?: React.ReactNode;
  reviewMenu?: React.ReactNode;
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
  onCopyMessage,
  pendingImages,
  reviewPanel,
  reviewMenu,
}: ChatPageProps) {
  const maxWidth = Math.max(20, terminalWidth - 6);
  const renderer = useRenderer();
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChanges>({ linesAdded: 0, linesRemoved: 0, filesModified: 0 });
  const [timerTick, setTimerTick] = useState(0);
  const [requireApprovals, setRequireApprovals] = useState(shouldRequireApprovals());
  const [hoveredUserMessageId, setHoveredUserMessageId] = useState<string | null>(null);
  const [userMessageModal, setUserMessageModal] = useState<{ id: string; index: number; content: string; images: ImageAttachment[] } | null>(null);
  const [hoveredActionId, setHoveredActionId] = useState<string | null>(null);
  const scrollboxRef = useRef<any>(null);

  function isCompactTool(toolName?: string): boolean {
    if (!toolName) return false;
    if (toolName === 'read' || toolName === 'list' || toolName === 'grep' || toolName === 'glob' || toolName === 'fetch' || toolName === 'title') return true;
    if (toolName.startsWith('mcp__')) {
      const nativeName = getNativeMcpToolName(toolName);
      return nativeName === 'navigation_search';
    }
    return false;
  }

  function getFirstBodyLine(content: string): string {
    const lines = (content || '').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const s = (lines[i] || '').trim();
      if (s) return s;
    }
    return '';
  }

  function getCompactResult(message: Message): string {
    if (message.isRunning) return 'running...';
    const toolName = message.toolName;
    if (toolName === 'title') {
      const argsTitle = message.toolArgs && typeof (message.toolArgs as any).title === 'string'
        ? String((message.toolArgs as any).title)
        : '';
      const resultObj = message.toolResult && typeof message.toolResult === 'object'
        ? (message.toolResult as Record<string, unknown>)
        : null;
      const resultTitle = typeof resultObj?.title === 'string' ? resultObj.title : '';
      const t = (argsTitle || resultTitle).replace(/[\r\n]+/g, ' ').trim();
      return t || 'Completed';
    }
    if (toolName === 'read' && typeof message.toolResult === 'string') {
      const lineCount = message.toolResult ? message.toolResult.split(/\r?\n/).length : 0;
      return `Read ${lineCount} lines`;
    }
    if ((toolName === 'glob' || toolName === 'list') && typeof message.toolResult === 'string') {
      try {
        const parsed = JSON.parse(message.toolResult);
        if (Array.isArray(parsed)) {
          return `${parsed.length} results`;
        }
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const files = Array.isArray(obj.files) ? obj.files : null;
          if (files) return `${files.length} results`;
        }
      } catch {
      }
    }

    const body = getFirstBodyLine(message.displayContent ?? message.content);
    return body || 'Completed';
  }

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
    }, 500);
    return () => clearInterval(interval);
  }, [messages]);

  useEffect(() => {
    const sb = scrollboxRef.current;
    if (sb?.verticalScrollBar) {
      sb.verticalScrollBar.visible = false;
    }
  }, []);

  useEffect(() => {
    if (!userMessageModal) {
      setHoveredActionId(null);
    }
  }, [userMessageModal]);

  useEffect(() => {
    const handleKeyPress = (key: KeyEvent) => {
      const k = key as any;
      if (k.name === "escape" && userMessageModal) {
        setUserMessageModal(null);
      }
    };
    renderer.keyInput.on("keypress", handleKeyPress);
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress);
    };
  }, [renderer.keyInput, userMessageModal]);

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
  const isUserModalOpen = Boolean(userMessageModal);
  const modalWidth = Math.min(70, Math.max(28, Math.floor(terminalWidth * 0.6)));
  const modalHeight = Math.max(7, Math.min(16, Math.floor(terminalHeight * 0.4)));

  const handleCopyMessage = () => {
    if (!userMessageModal) return;
    if (!onCopyMessage) return;
    onCopyMessage(userMessageModal.content ?? "");
    notifyNotification("Copied message to clipboard", "info", 2000);
    setUserMessageModal(null);
  };

  const modalActions = [
    { id: "copy", label: "Copy message text to clipboard", onActivate: handleCopyMessage }
  ];

  interface RenderItem {
    key: string;
    type: 'line' | 'question' | 'approval' | 'blend' | 'tool_compact';
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
    isCodeBlock?: boolean;
    codeLanguage?: string;
    codeContent?: string;
    codeHeight?: number;
    isTableRow?: boolean;
    tableCells?: string[];
    tableColumnWidths?: number[];
    tableRowIndex?: number;
    isPadding?: boolean;
    planStatus?: 'pending' | 'in_progress' | 'completed';
    isCompactTool?: boolean;
    compactLabel?: string;
    compactResult?: string;
    messageId?: string;
    messageIndex?: number;
    userMessageText?: string;
    userMessageImages?: ImageAttachment[];
  }

  const allItems: RenderItem[] = [];
  let pendingBlend: { key: string; blendDuration: number; blendWord: string } | null = null;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]!;
    const messageKey = message.id || `m-${messageIndex}`;
    const messageRole = message.displayRole ?? message.role;
    const userMessageText = message.displayContent ?? message.content;
    const userMessageImages = message.images ?? [];
    const userMessageMeta = messageRole === "user"
      ? { messageId: message.id, messageIndex, userMessageText, userMessageImages }
      : null;
    const compactTool = messageRole === 'tool' && isCompactTool(message.toolName);
    const shouldPadMessage = (messageRole === 'user' || messageRole === 'tool' || messageRole === 'slash')
      && Boolean((message.displayContent ?? message.content) || (message.images && message.images.length > 0))
      && !compactTool;

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

    if (shouldPadMessage) {
      allItems.push({
        key: `${messageKey}-message-top-pad`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        isSpacer: false,
        success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
        isRunning: message.isRunning,
        runningStartTime: message.runningStartTime,
        visualLines: 1,
        isPadding: true,
        ...(userMessageMeta ?? {})
      });
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
        if (block.type === 'code' && block.codeLines) {
          allItems.push({
            key: `${messageKey}-code-${blockIndex}-header`,
            type: 'line',
            role: messageRole,
            toolName: message.toolName,
            isFirst: isFirstContent,
            isCodeBlock: true,
            codeLanguage: block.language,
            codeContent: block.codeLines.join('\n'),
            codeHeight: Math.max(1, block.codeLines.length),
            visualLines: Math.max(1, block.codeLines.length)
          });
          if (block.codeLines.some(line => line.trim().length > 0)) {
            isFirstContent = false;
          }
          continue;
        }

        if (block.type === 'table' && block.tableRows && block.columnWidths && block.tableCellLines) {
          for (let rowIndex = 0; rowIndex < block.tableRows.length; rowIndex++) {
            const rowLines = block.tableCellLines[rowIndex] || [];
            const rowHeight = Math.max(1, ...rowLines.map(lines => lines.length));
            for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
              allItems.push({
                key: `${messageKey}-table-${blockIndex}-${rowIndex}-${lineIndex}`,
                type: 'line',
                content: '',
                role: messageRole,
                toolName: message.toolName,
                isFirst: isFirstContent && rowIndex === 0 && lineIndex === 0,
                isTableRow: true,
                tableCells: rowLines.map(lines => lines[lineIndex] ?? ''),
                tableColumnWidths: block.columnWidths,
                tableRowIndex: rowIndex,
                visualLines: 1
              });
            }
          }
          if (block.tableRows.some(row => row.some(cell => cell.trim().length > 0))) {
            isFirstContent = false;
          }
          continue;
        }

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
      if (messageRole === 'tool' && compactTool) {
        const { name, info } = parseToolHeader(message.toolName || '', message.toolArgs || {});
        const label = message.toolName === 'title' ? name : (info ? `${name} (${info})` : name);
        allItems.push({
          key: `${messageKey}-compact`,
          type: 'tool_compact',
          role: messageRole,
          toolName: message.toolName,
          isFirst: true,
          visualLines: 1,
          success: message.success,
          isRunning: message.isRunning,
          runningStartTime: message.runningStartTime,
          isCompactTool: true,
          compactLabel: label,
          compactResult: getCompactResult(message)
        });
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
              success: undefined,
              isSpacer: false,
              visualLines: 1,
              ...(userMessageMeta ?? {})
            });
          }
        }

        const messageText = message.displayContent ?? message.content;
        const paragraphs = messageText.split('\n');
        let isFirstContent = true;
        const planStatuses: Array<'pending' | 'in_progress' | 'completed'> = (messageRole === 'tool' && message.toolName === 'plan' && message.toolResult && typeof message.toolResult === 'object')
          ? (Array.isArray((message.toolResult as Record<string, unknown>).plan)
            ? (message.toolResult as Record<string, unknown>).plan as Array<Record<string, unknown>>
            : [])
            .map((item) => {
              if (!item || typeof item !== 'object') return 'pending';
              const status = (item as Record<string, unknown>).status;
              return status === 'completed' || status === 'in_progress' ? status : 'pending';
            })
          : [];
        const hasPending = planStatuses.includes('pending');
        const resolvedPlanStatuses = hasPending
          ? planStatuses
          : planStatuses.map((status) => (status === 'in_progress' ? 'completed' : status));
        let planStatusIndex = 0;

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
              runningStartTime: message.runningStartTime,
              ...(userMessageMeta ?? {})
            });
          } else {
            const indent = messageRole === 'tool' ? getToolParagraphIndent(i) : 0;
            const wrapTarget = messageRole === 'tool' ? getToolWrapTarget(paragraph, i) : paragraph;
            const wrapWidth = messageRole === 'tool' ? getToolWrapWidth(maxWidth, i) : maxWidth;
            const wrappedLines = wrapText(wrapTarget, wrapWidth);
            for (let j = 0; j < wrappedLines.length; j++) {
              const isPlanItemLine = messageRole === 'tool'
                && message.toolName === 'plan'
                && wrappedLines[j]
                && /^\[(.)\]\s+/.test(wrappedLines[j] || '');
              const planStatus = isPlanItemLine ? (resolvedPlanStatuses[planStatusIndex] ?? 'pending') : undefined;
              if (isPlanItemLine) planStatusIndex += 1;
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
                planStatus,
                isRunning: message.isRunning,
                runningStartTime: message.runningStartTime,
                ...(userMessageMeta ?? {})
              });
            }
            isFirstContent = false;
          }
        }
      }
    }

    if (!compactTool && shouldPadMessage) {
      allItems.push({
        key: `${messageKey}-message-bottom-pad`,
        type: 'line',
        content: '',
        role: messageRole,
        toolName: message.toolName,
        isFirst: false,
        isSpacer: false,
        success: (messageRole === 'tool' || messageRole === 'slash') ? message.success : undefined,
        isRunning: message.isRunning,
        runningStartTime: message.runningStartTime,
        visualLines: 1,
        isPadding: true,
        ...(userMessageMeta ?? {})
      });
    }

    if (message.isRunning && message.runningStartTime && messageRole === 'tool' && message.toolName !== 'explore' && !compactTool) {
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
                  maxWidth={Math.max(10, terminalWidth - 4)}
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
                  maxWidth={Math.max(10, terminalWidth - 4)}
                />
              </box>
            );
          }

          if (item.type === 'blend') {
            if (item.blendDuration && item.blendDuration > 60000) {
              const timeStr = formatElapsedTime(item.blendDuration, false);
              const label = `${item.blendWord} for ${timeStr}`;
              const innerWidth = Math.max(10, terminalWidth - 2);
              const leftSegment = `─ `;
              const rightCount = Math.max(0, innerWidth - (leftSegment.length + label.length + 1));
              return (
                <box key={item.key} flexDirection="row" width="100%" marginBottom={1}>
                  <text attributes={TextAttributes.DIM}>{leftSegment}</text>
                  <text attributes={TextAttributes.DIM}>{label} </text>
                  <text attributes={TextAttributes.DIM}>{'─'.repeat(rightCount)}</text>
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

          const showToolBarResolved = showToolBar && !isRunningTool && !item.isCompactTool;
          const showToolBackgroundResolved = showToolBackground && !isRunningTool && !item.isCompactTool;

          const diffBackground = item.isCodeBlock || item.isTableRow ? null : getDiffLineBackground(item.content || '');

          const codeBackground = null;
          const isUserMessageLine = item.role === "user" && Boolean(item.messageId) && !item.isSpacer;
          const isUserHover = isUserMessageLine && hoveredUserMessageId === item.messageId;
          const hasMessageBackground = item.isPadding
            || ((item.role === "user" && item.content) || showToolBackgroundResolved || showSlashBackground || showErrorBar);
          const hoverBackground = isUserHover ? "#262626" : null;
          const runningBackground = isRunningTool || item.isCompactTool
            ? "transparent"
            : (hoverBackground || codeBackground || diffBackground || (hasMessageBackground ? "#1a1a1a" : "transparent"));
          const handleUserMouseOver = isUserMessageLine ? () => {
            if (!isUserModalOpen) {
              setHoveredUserMessageId(item.messageId!);
            }
          } : undefined;
          const handleUserMouseOut = isUserMessageLine ? () => {
            setHoveredUserMessageId(prev => (prev === item.messageId ? null : prev));
          } : undefined;
          const handleUserMouseDown = isUserMessageLine ? (event: any) => {
            if (event?.isSelecting) return;
            if (event?.button !== undefined && event.button !== 0) return;
            setUserMessageModal({
              id: item.messageId!,
              index: item.messageIndex ?? 0,
              content: item.userMessageText ?? '',
              images: item.userMessageImages ?? []
            });
            setHoveredUserMessageId(null);
          } : undefined;

          return (
            <box
              key={item.key}
              flexDirection="row"
              width="100%"
              backgroundColor={runningBackground}
              paddingRight={((item.role === "user" && item.content) || showToolBackgroundResolved || showSlashBackground || showErrorBar) ? 1 : 0}
              onMouseOver={handleUserMouseOver}
              onMouseOut={handleUserMouseOut}
              onMouseDown={handleUserMouseDown}
            >
              {item.role === "user" && (item.content || item.isPadding) && (
                <text fg="#ffca38">▎ </text>
              )}
              {showToolBarResolved && (
                <text fg={item.success ? "#1a3a1a" : "#3a1a1a"}>▎ </text>
              )}
              {showSlashBar && (
                <text fg="white">▎ </text>
              )}

              {showErrorBar && (
                <text fg="#ff3838">▎ </text>
              )}
              {item.type === 'tool_compact' ? (
                (() => {
                  const isRunning = Boolean(item.isRunning);
                  const blinkOn = timerTick % 2 === 0;
                  const arrowColor = isRunning
                    ? (blinkOn ? 'white' : '#808080')
                    : (item.success ? '#44aa88' : '#ff3838');
                  const label = item.compactLabel || '';
                  const result = item.compactResult || '';
                  return (
                    <box flexDirection="row">
                      <text fg={arrowColor}>{'   '}➔  </text>
                      <text attributes={TextAttributes.DIM}>{`${label}${result ? ` : ${result}` : ''}`}</text>
                    </box>
                  );
                })()
              ) : item.isThinking ? (
                <text fg="#9a9a9a" attributes={TextAttributes.DIM}>{`${' '.repeat(item.indent || 0)}${item.content || ' '}`}</text>
              ) : item.isCodeBlock ? (
                <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={1}>
                  <code
                    content={item.codeContent ?? ''}
                    filetype={normalizeCodeFiletype(item.codeLanguage)}
                    syntaxStyle={CODE_SYNTAX_STYLE}
                    width="100%"
                    height={item.codeHeight ?? 1}
                    wrapMode="none"
                  />
                </box>
              ) : item.isTableRow && item.tableCells && item.tableColumnWidths ? (
                <box flexDirection="row">
                  {item.tableColumnWidths.map((width, colIndex) => {
                    const cell = item.tableCells?.[colIndex] ?? '';
                    const padded = ` ${cell.padEnd(width)} `;
                    const isHeader = item.tableRowIndex === 0;
                    const isLeftColumn = colIndex === 0;
                    const cellBg = isHeader || isLeftColumn ? TABLE_HEADER_BG : TABLE_BODY_BG;
                    const isLast = colIndex === item.tableColumnWidths!.length - 1;
                    return (
                      <box key={colIndex} flexDirection="row">
                        <text bg={cellBg} fg="white">{padded}</text>
                        {isLast ? null : <text bg={cellBg} fg="white"> </text>}
                      </box>
                    );
                  })}
                </box>
              ) : item.role === "tool" ? (
                <box flexDirection="row">
                  {isRunningTool && item.runningStartTime && item.paragraphIndex === 1 ? (
                    <text fg="#ffffff" attributes={TextAttributes.DIM}>  Running... {Math.floor((Date.now() - item.runningStartTime) / 1000)}s</text>
                  ) : (
                    renderToolText(item.content || ' ', item.paragraphIndex || 0, item.indent || 0, item.wrappedLineIndex || 0, item.toolName, item.planStatus)
                  )}
                </box>
              ) : item.role === "user" || item.role === "slash" ? (
                <text fg="white">{`${' '.repeat(item.indent || 0)}${item.content || ' '}`}</text>
              ) : item.segments && item.segments.length > 0 ? (
                <box flexDirection="row">
                  {item.segments.map((segment, segIndex) => renderMarkdownSegment(segment, segIndex))}
                </box>
              ) : (
                <text fg={item.isError ? "#ff3838" : "white"}>{item.content || ' '}</text>
              )}
            </box>
          );
        })}
      </scrollbox>

      {reviewPanel && (
        <box
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          right={0}
          flexDirection="column"
          zIndex={15}
        >
          {reviewPanel}
        </box>
      )}

      {reviewMenu && (
        <box
          position="absolute"
          bottom={inputBarBaseLines + 1}
          left={0}
          right={0}
          flexDirection="column"
          zIndex={16}
        >
          {reviewMenu}
        </box>
      )}

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
              placeholder={reviewPanel ? "Review changes above..." : "Type your message..."}
              focused={!shortcutsOpen && !questionRequest && !approvalRequest && !reviewPanel && !isUserModalOpen}
              pasteRequestId={(shortcutsOpen || isUserModalOpen) ? 0 : pasteRequestId}
              submitDisabled={isProcessing || shortcutsOpen || Boolean(questionRequest) || Boolean(approvalRequest) || Boolean(reviewPanel) || isUserModalOpen}
              maxWidth={Math.max(10, terminalWidth - 6)}
            />
          </box>
        </box>
      </box>

      <box position="absolute" bottom={0} left={0} right={0} flexDirection="row" paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg="#ffca38">{requireApprovals ? '' : '⏵⏵ auto-accept edits on'}</text>
        </box>
      </box>

      {!reviewMenu && (
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
      )}

      {userMessageModal && (
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          zIndex={20}
          onMouseDown={() => setUserMessageModal(null)}
        >
          <box width="100%" height="100%" justifyContent="center" alignItems="center">
            <box
              flexDirection="column"
              width={modalWidth}
              height={modalHeight}
              backgroundColor="#141414"
              opacity={0.92}
              padding={1}
              onMouseDown={(event: any) => event?.stopPropagation?.()}
            >
              <box marginBottom={1} flexDirection="row" justifyContent="space-between" width="100%">
                <text attributes={TextAttributes.BOLD}>Message Actions</text>
                <box flexDirection="row">
                  <text fg="white">esc </text>
                  <text attributes={TextAttributes.DIM}>close</text>
                </box>
              </box>
              <box flexDirection="column" width="100%" flexGrow={1} overflow="hidden">
                <box flexDirection="column" width="100%" overflow="scroll">
                  {modalActions.map((action) => {
                    const isHovered = hoveredActionId === action.id;
                    return (
                      <box
                        key={`user-modal-action-${action.id}`}
                        flexDirection="row"
                        width="100%"
                        backgroundColor={isHovered ? "#2a2a2a" : "transparent"}
                        paddingLeft={1}
                        paddingRight={1}
                        onMouseOver={() => setHoveredActionId(action.id)}
                        onMouseOut={() => setHoveredActionId(null)}
                        onMouseDown={(event: any) => {
                          event?.stopPropagation?.();
                          action.onActivate();
                        }}
                      >
                        <text fg="#ffca38">› </text>
                        <text>{action.label}</text>
                      </box>
                    );
                  })}
                </box>
              </box>
            </box>
          </box>
        </box>
      )}
    </box>
  );
}
