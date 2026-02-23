import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { getCompactToolResult, getToolInfo, getToolLabel, getToolStateClassName, getToolStateLabel, isCompactTool, renderToolIcon } from "../toolDisplay";
import type { CommandCompletionItem } from "../commandCompletion";

interface AgentPanelProps {
  messages: ChatMessage[];
  inputValue: string;
  isRunning: boolean;
  chatLogRef: React.RefObject<HTMLDivElement | null>;
  commandCompletions: CommandCompletionItem[];
  onInputChange: (value: string) => void;
  onApplyCompletion: (completion: CommandCompletionItem) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
}
const CHAT_ITEM_GAP = 24;
const CHAT_OVERSCAN_PX = 480;
const CHAT_FALLBACK_ROW_HEIGHT = 84;
const CHAT_USER_ROW_HEIGHT = 90;
const CHAT_TOOL_ROW_HEIGHT = 102;
const CHAT_SYSTEM_ROW_HEIGHT = 80;

function estimateRowHeight(message: ChatMessage): number {
  if (message.role === "user") return CHAT_USER_ROW_HEIGHT;
  if (message.role === "tool") return CHAT_TOOL_ROW_HEIGHT;
  if (message.role === "system") return CHAT_SYSTEM_ROW_HEIGHT;
  return CHAT_FALLBACK_ROW_HEIGHT;
}

function renderMessageContent(message: ChatMessage): React.ReactNode {
  if (message.role !== "tool") {
    if (message.role === "system") {
      if (message.isError) {
        return (
          <div className="chat-error-line">
            <span className="chat-error-bullet" aria-hidden="true">■</span>
            <span className="chat-error-text">{message.content}</span>
          </div>
        );
      }
      return (
        <>
          <div className="chat-item-head">system</div>
          <div className="chat-item-body">{message.content}</div>
        </>
      );
    }
    const content = message.role === "user" && message.displayContent ? message.displayContent : message.content;
    return <div className="chat-item-body">{content}</div>;
  }

  const compact = isCompactTool(message.toolName);
  const label = getToolLabel(message.toolName);
  const info = getToolInfo(message.toolArgs);
  const stateLabel = getToolStateLabel(message);
  const stateClass = getToolStateClassName(message);
  const body = compact ? getCompactToolResult(message) : message.content;

  return (
    <>
      <div className="chat-item-head chat-tool-head">
        <span className="chat-tool-icon" aria-hidden="true">{renderToolIcon(message.toolName)}</span>
        <span className="chat-tool-label">{label}</span>
        {info ? <span className="chat-tool-info">{info}</span> : null}
        <span className={`chat-tool-state ${stateClass}`}>{stateLabel}</span>
      </div>
      <div className={`chat-item-body ${compact ? "chat-tool-compact-result" : ""}`}>{body}</div>
    </>
  );
}

interface ChatLogProps {
  messages: ChatMessage[];
  chatLogRef: React.RefObject<HTMLDivElement | null>;
}

interface VirtualLayoutRow {
  message: ChatMessage;
  top: number;
  height: number;
}

interface VirtualChatRowProps {
  row: VirtualLayoutRow;
  onHeight: (messageId: string, height: number) => void;
}

const VirtualChatRow = memo(function VirtualChatRow(props: VirtualChatRowProps) {
  const articleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = articleRef.current;
    if (!node) return;
    const measure = () => {
      props.onHeight(props.row.message.id, node.getBoundingClientRect().height);
    };
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.row.message.id, props.onHeight]);

  return (
    <article
      ref={articleRef}
      className={`chat-item chat-log-row ${props.row.message.role}${props.row.message.running ? " running" : ""}${props.row.message.isError ? " error" : ""}`}
      style={{ transform: `translateY(${props.row.top}px)` }}
    >
      {renderMessageContent(props.row.message)}
    </article>
  );
});

const ChatLog = memo(function ChatLog(props: ChatLogProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const scrollFrameRef = useRef<number | null>(null);

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    localRef.current = node;
    props.chatLogRef.current = node;
  }, [props.chatLogRef]);

  const updateViewport = useCallback(() => {
    const node = localRef.current;
    if (!node) return;
    const nextTop = node.scrollTop;
    const nextHeight = node.clientHeight;
    setScrollTop((prev) => (Math.abs(prev - nextTop) < 1 ? prev : nextTop));
    setViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const onScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateViewport();
    });
  }, [updateViewport]);

  useEffect(() => {
    updateViewport();
  }, [updateViewport]);

  useEffect(() => {
    const node = localRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateViewport();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateViewport]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }, []);

  const onRowHeight = useCallback((messageId: string, nextHeight: number) => {
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    setRowHeights((prev) => {
      const currentHeight = prev[messageId];
      if (typeof currentHeight === "number" && Math.abs(currentHeight - nextHeight) < 1) {
        return prev;
      }
      return { ...prev, [messageId]: nextHeight };
    });
  }, []);

  useEffect(() => {
    const validIds = new Set(props.messages.map((message) => message.id));
    setRowHeights((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (validIds.has(id)) {
          next[id] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [props.messages]);

  const layout = useMemo(() => {
    const rows: VirtualLayoutRow[] = [];
    let offset = 0;
    for (const message of props.messages) {
      const measured = rowHeights[message.id];
      const height = typeof measured === "number" ? measured : estimateRowHeight(message);
      rows.push({
        message,
        top: offset,
        height,
      });
      offset += height + CHAT_ITEM_GAP;
    }
    const totalHeight = rows.length > 0 ? offset - CHAT_ITEM_GAP : 0;
    return { rows, totalHeight };
  }, [props.messages, rowHeights]);

  const visibleRows = useMemo(() => {
    const rows = layout.rows;
    if (rows.length === 0) return rows;
    if (viewportHeight <= 0) {
      return rows.slice(Math.max(0, rows.length - 40), rows.length);
    }

    const minY = Math.max(0, scrollTop - CHAT_OVERSCAN_PX);
    const maxY = scrollTop + viewportHeight + CHAT_OVERSCAN_PX;
    let start = 0;
    while (start < rows.length && rows[start]!.top + rows[start]!.height < minY) {
      start += 1;
    }
    let end = start;
    while (end < rows.length && rows[end]!.top <= maxY) {
      end += 1;
    }
    return rows.slice(Math.max(0, start), Math.min(rows.length, end));
  }, [layout.rows, scrollTop, viewportHeight]);

  return (
    <div className="chat-log" ref={setContainerRef} onScroll={onScroll}>
      <div className="chat-log-virtual" style={{ height: `${layout.totalHeight}px` }}>
        {visibleRows.map((row) => (
          <VirtualChatRow key={row.message.id} row={row} onHeight={onRowHeight} />
        ))}
      </div>
    </div>
  );
});

export function AgentPanel(props: AgentPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [completionIndex, setCompletionIndex] = useState(0);
  const canSend = Boolean(props.inputValue.trim());
  const actionTitle = props.isRunning ? "Stop generation" : "Send message";
  const showCompletions = !props.isRunning && props.commandCompletions.length > 0;

  useEffect(() => {
    setCompletionIndex(0);
  }, [props.commandCompletions]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
    }
  }, [props.inputValue]);

  return (
    <aside className="panel chat-panel">
      <ChatLog messages={props.messages} chatLogRef={props.chatLogRef} />
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            rows={1}
            placeholder="Ask Mosaic..."
            value={props.inputValue}
            onChange={(event) => props.onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (showCompletions && event.key === "Tab") {
                event.preventDefault();
                const current = props.commandCompletions[Math.max(0, Math.min(completionIndex, props.commandCompletions.length - 1))];
                if (current) {
                  props.onApplyCompletion(current);
                }
                return;
              }
              if (showCompletions && event.key === "ArrowDown") {
                event.preventDefault();
                setCompletionIndex((prev) => {
                  if (props.commandCompletions.length === 0) return 0;
                  return prev >= props.commandCompletions.length - 1 ? 0 : prev + 1;
                });
                return;
              }
              if (showCompletions && event.key === "ArrowUp") {
                event.preventDefault();
                setCompletionIndex((prev) => {
                  if (props.commandCompletions.length === 0) return 0;
                  return prev <= 0 ? props.commandCompletions.length - 1 : prev - 1;
                });
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                props.onSend();
              }
            }}
          />
          {showCompletions ? (
            <div className="command-completion-popover" role="listbox" aria-label="Command suggestions">
              {props.commandCompletions.map((completion, index) => {
                const active = index === completionIndex;
                return (
                  <button
                    key={completion.key}
                    type="button"
                    className={`command-completion-item ${active ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      props.onApplyCompletion(completion);
                    }}
                  >
                    <span className="command-completion-label">{completion.label}</span>
                    <span className="command-completion-detail">{completion.detail}</span>
                  </button>
                );
              })}
              <div className="command-completion-help">Tab to complete · ↑↓ to navigate</div>
            </div>
          ) : null}
          <div className="chat-input-bottom">
            <button className="icon-button paperclip-btn" title="Attach context">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
            <div className="chat-input-actions">
              <button className="icon-button mic-btn" title="Voice input">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
              </button>
              <button
                className={`send-button ${props.isRunning ? "stop" : "send"}`}
                onClick={props.isRunning ? props.onStop : props.onSend}
                disabled={!props.isRunning && !canSend}
                title={actionTitle}
              >
                {props.isRunning ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
    </aside>
  );
}
