import { useState, useEffect, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { CustomInput } from "./CustomInput";
import { VERSION } from "../utils/version";
import { useKeyboard } from "@opentui/react";
import { Agent } from "../agent";
import { renderMarkdownSegment, parseAndWrapMarkdown } from "../utils/markdown";
import { saveConversation, addInputToHistory, type ConversationHistory, type ConversationStep } from "../utils/history";
import { readConfig } from "../utils/config";
import {
  DEFAULT_MAX_TOOL_LINES,
  formatToolMessage,
  getToolParagraphIndent,
  getToolWrapTarget,
  getToolWrapWidth,
} from "../utils/toolFormatting";

interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  success?: boolean;
  isError?: boolean;
}

interface MainProps {
  pasteRequestId?: number;
  copyRequestId?: number;
  onCopy?: (text: string) => void;
  shortcutsOpen?: boolean;
}

export function Main({ pasteRequestId = 0, copyRequestId = 0, onCopy, shortcutsOpen = false }: MainProps) {
  const [currentPage, setCurrentPage] = useState<"home" | "chat">("home");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(process.stdout.rows || 24);
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  const shouldAutoScroll = useRef(true);

  const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  useEffect(() => {
    const handleResize = () => {
      const newWidth = process.stdout.columns || 80;
      const newHeight = process.stdout.rows || 24;
      setTerminalWidth(newWidth);
      setTerminalHeight(newHeight);
      setScrollOffset(prev => {
        if (shouldAutoScroll.current) return 0;
        return prev;
      });
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  const wrapText = (text: string, maxWidth: number): string[] => {
    if (!text) return [''];
    if (text.length <= maxWidth) return [text];

    const lines: string[] = [];
    let currentLine = '';
    let i = 0;

    while (i < text.length) {
      const char = text[i];

      if (char === ' ' && currentLine.length === maxWidth) {
        lines.push(currentLine);
        currentLine = '';
        i++;
        continue;
      }

      if (currentLine.length + 1 > maxWidth) {
        const lastSpaceIndex = currentLine.lastIndexOf(' ');
        if (lastSpaceIndex > 0) {
          lines.push(currentLine.slice(0, lastSpaceIndex));
          currentLine = currentLine.slice(lastSpaceIndex + 1) + char;
        } else {
          lines.push(currentLine);
          currentLine = char || '';
        }
      } else {
        currentLine += char;
      }

      i++;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  };

  useEffect(() => {
    if (currentPage !== "chat") return;

    process.stdin.setRawMode(true);
    process.stdout.write('\x1b[?1000h');
    process.stdout.write('\x1b[?1003h');
    process.stdout.write('\x1b[?1006h');

    const handleData = (data: Buffer) => {
      const str = data.toString();

      if (str.match(/\x1b\[<(\d+);(\d+);(\d+)([mM])/)) {
        const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([mM])/);
        if (match) {
          const button = parseInt(match[1] || '0');

          if (button === 64) {
            shouldAutoScroll.current = false;
            setScrollOffset((prev) => prev + 1);
          } else if (button === 65) {
            setScrollOffset((prev) => {
              const newOffset = Math.max(0, prev - 1);
              if (newOffset === 0) {
                shouldAutoScroll.current = true;
              }
              return newOffset;
            });
          }
        }
      }
    };

    process.stdin.on('data', handleData);

    return () => {
      process.stdin.off('data', handleData);
      process.stdout.write('\x1b[?1000l');
      process.stdout.write('\x1b[?1003l');
      process.stdout.write('\x1b[?1006l');
    };
  }, [currentPage]);

  useEffect(() => {
    if (currentPage === "chat") {
      setScrollOffset((prevOffset) => {
        if (shouldAutoScroll.current || prevOffset < 5) {
          shouldAutoScroll.current = true;
          return 0;
        }
        return prevOffset;
      });
    }
  }, [messages, currentPage]);

  useEffect(() => {
    if (copyRequestId > 0 && onCopy && messages.length > 0) {
      const lastAssistantMessage = messages.slice().reverse().find(m => m.role === 'assistant');
      if (lastAssistantMessage) {
        onCopy(lastAssistantMessage.content);
      }
    }
  }, [copyRequestId, onCopy, messages]);

  useKeyboard((key) => {
    if (currentPage !== "chat") return;
    if (shortcutsOpen) return;

    if (key.name === 'up') {
      shouldAutoScroll.current = false;
      setScrollOffset((prev) => prev + 1);
    } else if (key.name === 'down') {
      setScrollOffset((prev) => {
        const newOffset = Math.max(0, prev - 1);
        if (newOffset === 0) {
          shouldAutoScroll.current = true;
        }
        return newOffset;
      });
    } else if (key.name === 'pageup') {
      shouldAutoScroll.current = false;
      setScrollOffset((prev) => prev + 10);
    } else if (key.name === 'pagedown') {
      setScrollOffset((prev) => {
        const newOffset = Math.max(0, prev - 10);
        if (newOffset === 0) {
          shouldAutoScroll.current = true;
        }
        return newOffset;
      });
    }
  });

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return;

    addInputToHistory(value);

    const userMessage: Message = { id: createId(), role: "user", content: value };
    setMessages((prev: Message[]) => [...prev, userMessage]);
    setIsProcessing(true);
    shouldAutoScroll.current = true;

    const conversationId = createId();
    const conversationSteps: ConversationStep[] = [];
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let stepCount = 0;
    const config = readConfig();

    conversationSteps.push({
      type: 'user',
      content: value,
      timestamp: Date.now()
    });

    try {
      const agent = new Agent();
      const conversationHistory = [...messages, userMessage]
        .filter((m): m is Message & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));
      let assistantChunk = '';
      const pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown> }>();
      let assistantMessageId: string | null = null;
      let streamHadError = false;

      for await (const event of agent.streamMessages(conversationHistory)) {
        if (event.type === 'text-delta') {
          assistantChunk += event.content;

          if (assistantMessageId === null) {
            assistantMessageId = createId();
          }

          const currentMessageId = assistantMessageId;
          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            const messageIndex = newMessages.findIndex(m => m.id === currentMessageId);

            if (messageIndex === -1) {
              newMessages.push({ id: currentMessageId, role: "assistant", content: assistantChunk });
            } else {
              newMessages[messageIndex] = {
                ...newMessages[messageIndex]!,
                content: assistantChunk
              };
            }
            return newMessages;
          });
        } else if (event.type === 'step-start') {
          stepCount++;
        } else if (event.type === 'tool-call-end') {
          pendingToolCalls.set(event.toolCallId, { toolName: event.toolName, args: event.args });
        } else if (event.type === 'tool-result') {
          const pending = pendingToolCalls.get(event.toolCallId);
          const toolName = pending?.toolName ?? event.toolName;
          const toolArgs = pending?.args ?? {};
          pendingToolCalls.delete(event.toolCallId);
          const { content: toolContent, success } = formatToolMessage(
            toolName,
            toolArgs,
            event.result,
            { maxLines: DEFAULT_MAX_TOOL_LINES }
          );

          if (assistantChunk.trim()) {
            conversationSteps.push({
              type: 'assistant',
              content: assistantChunk,
              timestamp: Date.now()
            });
          }

          conversationSteps.push({
            type: 'tool',
            content: toolContent,
            toolName,
            toolArgs,
            toolResult: event.result,
            timestamp: Date.now()
          });

          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            newMessages.push({
              id: createId(),
              role: "tool",
              content: toolContent,
              toolName,
              success: success
            });
            return newMessages;
          });

          assistantChunk = '';
          assistantMessageId = null;
        } else if (event.type === 'error') {
          if (assistantChunk.trim()) {
            conversationSteps.push({
              type: 'assistant',
              content: assistantChunk,
              timestamp: Date.now()
            });
          }

          const errorContent = `API error: ${event.error}`;
          conversationSteps.push({
            type: 'assistant',
            content: errorContent,
            timestamp: Date.now()
          });

          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            newMessages.push({
              id: createId(),
              role: 'assistant',
              content: errorContent,
              isError: true,
            });
            return newMessages;
          });

          assistantChunk = '';
          assistantMessageId = null;
          streamHadError = true;
          break;
        } else if (event.type === 'finish') {
          if (event.usage) {
            totalTokens = {
              prompt: event.usage.promptTokens,
              completion: event.usage.completionTokens,
              total: event.usage.totalTokens
            };
          }
        }
      }

      if (!streamHadError && assistantChunk.trim()) {
        conversationSteps.push({
          type: 'assistant',
          content: assistantChunk,
          timestamp: Date.now()
        });
      }

      const conversationData: ConversationHistory = {
        id: conversationId,
        timestamp: Date.now(),
        steps: conversationSteps,
        totalSteps: stepCount,
        totalTokens: totalTokens.total > 0 ? totalTokens : undefined,
        model: config.model,
        provider: config.provider
      };

      saveConversation(conversationData);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setMessages((prev: Message[]) => {
        const newMessages = [...prev];
        if (newMessages[newMessages.length - 1]?.role === 'assistant' && newMessages[newMessages.length - 1]?.content === '') {
          newMessages[newMessages.length - 1] = {
            id: newMessages[newMessages.length - 1]!.id,
            role: "assistant",
            content: `Mosaic error: ${errorMessage}`,
            isError: true
          };
        } else {
          newMessages.push({
            id: createId(),
            role: "assistant",
            content: `Mosaic error: ${errorMessage}`,
            isError: true
          });
        }
        return newMessages;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (currentPage === "home") {
    const handleHomeSubmit = (value: string) => {
      if (!value.trim()) return;
      setCurrentPage("chat");
      handleSubmit(value);
    };

    return (
      <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╗   ███╗</text>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>████╗ ████║</text>
          <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╔████╔███║</text>
        </box>

        <box width="80%" maxWidth={80}>
          <box
            flexDirection="row"
            backgroundColor="#1a1a1a"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <CustomInput
              onSubmit={handleHomeSubmit}
              placeholder="Ask anything..."
              focused={!shortcutsOpen}
              pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            />
          </box>
        </box>

        <box position="absolute" bottom={1} right={2}>
          <text fg="gray" attributes={TextAttributes.DIM}>v{VERSION}</text>
        </box>
      </box>
    );
  }

  const maxWidth = Math.max(20, terminalWidth - 6);
  const viewportHeight = Math.max(5, terminalHeight - 5);

  interface RenderItem {
    key: string;
    type: 'line';
    content?: string;
    role: "user" | "assistant" | "tool";
    isFirst: boolean;
    indent?: number;
    segments?: import("../utils/markdown").MarkdownSegment[];
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
        const paragraph = paragraphs[i];
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
              onSubmit={handleSubmit}
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