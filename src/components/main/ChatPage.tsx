import { useEffect, useState, useRef } from "react";
import { TextAttributes, SyntaxStyle, RGBA, type KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { renderMarkdownSegment } from "../../utils/markdown";
import { subscribeQuestion, answerQuestion, type QuestionRequest } from "../../utils/questionBridge";
import { subscribeApproval, respondApproval, type ApprovalRequest } from "../../utils/approvalBridge";
import { subscribeApprovalMode } from "../../utils/approvalModeBridge";
import { shouldRequireApprovals } from "../../utils/config";
import { subscribeFileChanges } from "../../utils/fileChangesBridge";
import type { FileChanges } from "../../utils/fileChangeTracker";
import { notifyNotification } from "../../utils/notificationBridge";
import { CustomInput } from "../CustomInput";
import type { Message, TokenBreakdown } from "./types";
import type { ImageAttachment } from "../../utils/images";
import { QuestionPanel } from "./QuestionPanel";
import { ApprovalPanel, type RuleAction } from "./ApprovalPanel";
import { addAutoRunRule } from "../../utils/localRules";
import { ThinkingIndicatorBlock, getBottomReservedLinesForInputBar, getInputBarBaseLines, formatElapsedTime } from "./ThinkingIndicator";
import { renderInlineDiffLine, getDiffLineBackground } from "../../utils/diffRendering";
import { buildChatItems, getPlanProgress, type RenderItem } from "./chatItemBuilder";
import { UserMessageModal, type UserMessageModalState } from "./UserMessageModal";

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

function renderToolText(content: string, paragraphIndex: number, indent: number, wrappedLineIndex: number, toolName?: string, planStatus?: 'pending' | 'in_progress' | 'completed', codeLanguage?: string) {
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


  const diffLineRender = renderInlineDiffLine(content, codeLanguage);
  if (diffLineRender) {
    return diffLineRender;
  }

  return <text fg="white" attributes={paragraphIndex > 0 ? TextAttributes.DIM : 0}>{`${' '.repeat(indent)}${content || ' '}`}</text>;
}

interface ChatPageProps {
  messages: Message[];
  isProcessing: boolean;
  processingStartTime: number | null;
  currentTokens: number;
  tokenBreakdown?: TokenBreakdown;
  scrollOffset: number;
  terminalHeight: number;
  terminalWidth: number;
  pasteRequestId: number;
  shortcutsOpen: boolean;
  onSubmit: (value: string, meta?: import("../CustomInput").InputSubmitMeta) => void;
  onCopyMessage?: (text: string) => void;
  onResubmitUserMessage?: (payload: { id: string; index: number; content: string; images: ImageAttachment[] }) => void;
  pendingImages: ImageAttachment[];
  reviewPanel?: React.ReactNode;
  reviewMenu?: React.ReactNode;
  selectMenu?: React.ReactNode;
  onModalOpenChange?: (open: boolean) => void;
}

export function ChatPage({
  messages,
  isProcessing,
  processingStartTime,
  currentTokens,
  tokenBreakdown,
  scrollOffset,
  terminalHeight,
  terminalWidth,
  pasteRequestId,
  shortcutsOpen,
  onSubmit,
  onCopyMessage,
  onResubmitUserMessage,
  pendingImages,
  reviewPanel,
  reviewMenu,
  selectMenu,
  onModalOpenChange,
}: ChatPageProps) {
  const maxWidth = Math.max(20, terminalWidth - 6);
  const renderer = useRenderer();
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChanges>({ linesAdded: 0, linesRemoved: 0, filesModified: 0 });
  const [timerTick, setTimerTick] = useState(0);
  const [requireApprovals, setRequireApprovals] = useState(shouldRequireApprovals());
  const [hoveredUserMessageId, setHoveredUserMessageId] = useState<string | null>(null);
  const [userMessageModal, setUserMessageModal] = useState<UserMessageModalState | null>(null);
  const scrollboxRef = useRef<any>(null);
  const prevScrollOffsetRef = useRef(scrollOffset);
  const userMessageModalRef = useRef(userMessageModal);

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
    userMessageModalRef.current = userMessageModal;
  }, [userMessageModal]);

  useEffect(() => {
    onModalOpenChange?.(Boolean(userMessageModal));
  }, [onModalOpenChange, userMessageModal]);

  useEffect(() => {
    const handleKeyPress = (key: KeyEvent) => {
      const k = key as any;
      if (k.name === "escape" && userMessageModalRef.current) {
        setUserMessageModal(null);
      }
    };
    renderer.keyInput.on("keypress", handleKeyPress);
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress);
    };
  }, [renderer.keyInput]);

  const planProgress = getPlanProgress(messages);
  const extraInputLines = pendingImages.length > 0 ? 1 : 0;
  const inputBarBaseLines = getInputBarBaseLines() + extraInputLines;
  const bottomReservedLines = getBottomReservedLinesForInputBar({
    isProcessing,
    hasQuestion: Boolean(questionRequest) || Boolean(approvalRequest),
    inProgressStep: planProgress.inProgressStep,
    nextStep: planProgress.nextStep,
  }) + extraInputLines;
  const viewportHeight = Math.max(5, terminalHeight - bottomReservedLines);
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

  const handleRetryMessage = () => {
    if (!userMessageModal) return;
    onResubmitUserMessage?.({
      id: userMessageModal.id,
      index: userMessageModal.index,
      content: userMessageModal.content ?? '',
      images: userMessageModal.images ?? []
    });
    setUserMessageModal(null);
  };

  const handleOpenEdit = () => {
    if (!userMessageModal) return;
    setUserMessageModal({
      ...userMessageModal,
      mode: 'edit',
      editSeed: userMessageModal.content ?? ''
    });
  };

  const handleCloseEdit = () => {
    if (!userMessageModal) return;
    setUserMessageModal({
      ...userMessageModal,
      mode: 'actions'
    });
  };

  const handleEditSubmit = (value: string) => {
    if (!userMessageModal) return;
    if (!value.trim() && (userMessageModal.images?.length ?? 0) === 0) return;
    onResubmitUserMessage?.({
      id: userMessageModal.id,
      index: userMessageModal.index,
      content: value,
      images: userMessageModal.images ?? []
    });
    setUserMessageModal(null);
  };

  const allItems = buildChatItems({ messages, maxWidth, viewportHeight, questionRequest, approvalRequest });

  const totalVisualLines = allItems.reduce((sum, item) => sum + item.visualLines, 0);
  const maxScrollOffset = Math.max(0, totalVisualLines - viewportHeight);
  const clampedScrollOffset = Math.max(0, Math.min(scrollOffset, maxScrollOffset));
  const scrollYPosition = Math.max(0, totalVisualLines - viewportHeight - clampedScrollOffset);

  useEffect(() => {
    const sb = scrollboxRef.current;
    if (!sb || typeof sb.scrollTo !== 'function') return;

    if (scrollOffset !== prevScrollOffsetRef.current) {
      sb.scrollTo(scrollYPosition);
    }

    prevScrollOffsetRef.current = scrollOffset;
  }, [scrollYPosition, scrollOffset]);

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
                  onRespond={(approved, customResponse, ruleAction) => {
                    if (ruleAction === 'auto-run' && req.toolName === 'bash') {
                      const command = String(req.args.command ?? '');
                      if (command) addAutoRunRule(command);
                    }
                    respondApproval(approved, customResponse);
                  }}
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
          const showSlashBar = item.role === "slash" && item.isSpacer === false;
          const showSlashBackground = item.role === "slash" && item.isSpacer === false;
          const isRunningTool = item.isRunning && item.runningStartTime;

          const isToolItem = item.role === "tool";
          const needsToolPadding = isToolItem && !item.isSpacer && !item.isCompactTool && !isRunningTool && item.toolName !== "plan";
          const diffBackground = item.isCodeBlock || item.isTableRow ? null : getDiffLineBackground(item.content || '');
          const isInlineDiff = isToolItem && Boolean(diffBackground);
          const isWriteEditInlineDiff = isToolItem
            && (item.toolName === "write" || item.toolName === "edit")
            && Boolean(diffBackground);
          const leftPadding = needsToolPadding ? 1 : 0;

          const codeBackground = null;
          const isUserMessageLine = item.role === "user" && Boolean(item.messageId) && !item.isSpacer;
          const isUserHover = isUserMessageLine && hoveredUserMessageId === item.messageId;
          const hasMessageBackground = (item.isPadding && !isToolItem)
            || ((item.role === "user" && item.content) || showSlashBackground || showErrorBar);
          const hoverBackground = isUserHover ? "#262626" : null;
          const runningBackground = isRunningTool || item.isCompactTool
            ? "transparent"
            : (hoverBackground || codeBackground || diffBackground || (hasMessageBackground ? "#1a1a1a" : "transparent"));
          const rowBackground = isInlineDiff ? "transparent" : runningBackground;
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
              images: item.userMessageImages ?? [],
              mode: 'actions'
            });
            setHoveredUserMessageId(null);
          } : undefined;

          return (
            <box
              key={item.key}
              flexDirection="row"
              width="100%"
              backgroundColor={rowBackground}
              paddingLeft={leftPadding}
              paddingRight={((item.role === "user" && item.content) || showSlashBackground || showErrorBar) ? 1 : 0}
              onMouseOver={handleUserMouseOver}
              onMouseOut={handleUserMouseOut}
              onMouseDown={handleUserMouseDown}
            >
              {item.role === "user" && (item.content || item.isPadding) && (
                <text fg="#ffca38">▎ </text>
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
                  const isReview = item.toolName === 'review';
                  const arrowColor = isRunning
                    ? (blinkOn ? 'white' : '#808080')
                    : isReview ? '#44aa88' : (item.success ? '#44aa88' : '#ff3838');
                  const label = item.compactLabel || '';
                  const result = item.compactResult || '';
                  return (
                    <box flexDirection="row">
                      <text fg={arrowColor}>{'   '}➔  </text>
                      <text attributes={TextAttributes.DIM}>{`${label}${result ? ` : ${result}` : ''}`}</text>
                    </box>
                  );
                })()
              ) : item.isHorizontalRule ? (
                <text fg="#3a3a3a">{'─'.repeat(Math.max(0, terminalWidth - 4))}</text>
              ) : item.isThinking ? (
                <text fg="#9a9a9a" attributes={TextAttributes.DIM | TextAttributes.ITALIC}>{`${' '.repeat(item.indent || 0)}${item.content || ' '}`}</text>
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
                  {isInlineDiff && diffBackground ? (
                    <box flexDirection="row" width="100%">
                      {isWriteEditInlineDiff ? <text>{'   '}</text> : null}
                      <box flexDirection="row" flexGrow={1} minWidth={0} backgroundColor={diffBackground}>
                        {renderToolText(item.content || ' ', item.paragraphIndex || 0, item.indent || 0, item.wrappedLineIndex || 0, item.toolName, item.planStatus, item.codeLanguage)}
                      </box>
                    </box>
                  ) : isRunningTool && item.runningStartTime && item.paragraphIndex === 1 ? (
                    <text fg="#ffffff" attributes={TextAttributes.DIM}>  Running... {Math.floor((Date.now() - item.runningStartTime) / 1000)}s</text>
                  ) : (
                    renderToolText(item.content || ' ', item.paragraphIndex || 0, item.indent || 0, item.wrappedLineIndex || 0, item.toolName, item.planStatus, item.codeLanguage)
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

      {selectMenu}

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
              focused={!shortcutsOpen && !questionRequest && !approvalRequest && !reviewPanel && !isUserModalOpen && !selectMenu}
              pasteRequestId={(shortcutsOpen || isUserModalOpen) ? 0 : pasteRequestId}
              submitDisabled={isProcessing || shortcutsOpen || Boolean(questionRequest) || Boolean(approvalRequest) || Boolean(reviewPanel) || isUserModalOpen || Boolean(selectMenu)}
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
            tokenBreakdown={tokenBreakdown}
            inProgressStep={planProgress.inProgressStep}
            nextStep={planProgress.nextStep}
          />
        </box>
      )}

      {userMessageModal && (
        <UserMessageModal
          modal={userMessageModal}
          modalWidth={modalWidth}
          modalHeight={modalHeight}
          shortcutsOpen={shortcutsOpen}
          isProcessing={isProcessing}
          onClose={() => setUserMessageModal(null)}
          onRetry={handleRetryMessage}
          onOpenEdit={handleOpenEdit}
          onCloseEdit={handleCloseEdit}
          onEditSubmit={handleEditSubmit}
          onCopy={handleCopyMessage}
        />
      )}
    </box>
  );
}
