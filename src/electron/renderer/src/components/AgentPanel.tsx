import React, { useEffect, useRef, useState } from "react";
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

  const renderMessage = (message: ChatMessage) => {
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
  };

  return (
    <aside className="panel chat-panel">
      <div className="chat-log" ref={props.chatLogRef}>
        {props.messages.map((message) => (
          <article key={message.id} className={`chat-item ${message.role}${message.running ? " running" : ""}${message.isError ? " error" : ""}`}>
            {renderMessage(message)}
          </article>
        ))}
      </div>
      <div className="composer">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            rows={1}
            placeholder="Ask Mosaic..."
            value={props.inputValue}
            disabled={props.isRunning}
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
      </div>
    </aside>
  );
}
