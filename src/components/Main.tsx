import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { Agent } from "../agent";
import { saveConversation, addInputToHistory, type ConversationHistory, type ConversationStep } from "../utils/history";
import { readConfig } from "../utils/config";
import { DEFAULT_MAX_TOOL_LINES, formatToolMessage } from "../utils/toolFormatting";
import type { MainProps, Message } from "./main/types";
import { HomePage } from "./main/HomePage";
import { ChatPage } from "./main/ChatPage";

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
      const providerStatus = await Agent.ensureProviderReady();
      if (!providerStatus.ready) {
        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          newMessages.push({
            id: createId(),
            role: "assistant",
            content: `Ollama error: ${providerStatus.error || 'Could not start Ollama. Make sure Ollama is installed.'}`,
            isError: true
          });
          return newMessages;
        });
        setIsProcessing(false);
        return;
      }

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
      <HomePage
        onSubmit={handleHomeSubmit}
        pasteRequestId={pasteRequestId}
        shortcutsOpen={shortcutsOpen}
      />
    );
  }

  return (
    <ChatPage
      messages={messages}
      isProcessing={isProcessing}
      scrollOffset={scrollOffset}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
      pasteRequestId={pasteRequestId}
      shortcutsOpen={shortcutsOpen}
      onSubmit={handleSubmit}
    />
  );
}