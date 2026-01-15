import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { Agent } from "../agent";
import { saveConversation, addInputToHistory, type ConversationHistory, type ConversationStep } from "../utils/history";
import { readConfig } from "../utils/config";
import { DEFAULT_MAX_TOOL_LINES, formatToolMessage } from '../utils/toolFormatting';
import { initializeCommands, isCommand, executeCommand } from '../utils/commands';
import type { InputSubmitMeta } from './CustomInput';

import { subscribeQuestion, type QuestionRequest } from "../utils/questionBridge";
import { BLEND_WORDS, type MainProps, type Message } from "./main/types";
import { HomePage } from './main/HomePage';
import { ChatPage } from './main/ChatPage';

export function Main({ pasteRequestId = 0, copyRequestId = 0, onCopy, shortcutsOpen = false, commandsOpen = false }: MainProps) {
  const [currentPage, setCurrentPage] = useState<"home" | "chat">("home");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(process.stdout.rows || 24);
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const shouldAutoScroll = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentPageRef = useRef(currentPage);
  const shortcutsOpenRef = useRef(shortcutsOpen);
  const commandsOpenRef = useRef(commandsOpen);
  const questionRequestRef = useRef<QuestionRequest | null>(questionRequest);

  const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  useEffect(() => {
    initializeCommands();
  }, []);

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
    return subscribeQuestion(setQuestionRequest);
  }, []);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    shortcutsOpenRef.current = shortcutsOpen;
  }, [shortcutsOpen]);

  useEffect(() => {
    commandsOpenRef.current = commandsOpen;
  }, [commandsOpen]);

  useEffect(() => {
    questionRequestRef.current = questionRequest;
  }, [questionRequest]);

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
    if (key.name === 'escape') {
      abortControllerRef.current?.abort();
      return;
    }
  });

  const handleSubmit = async (value: string, meta?: InputSubmitMeta) => {
    if (isProcessing) return;

    const buildPastedDisplay = (blocks: { lineCount: number }[]) => {
      return blocks
        .map((b, i) => {
          const n = i + 1;
          const linesLabel = b.lineCount === 1 ? 'line' : 'lines';
          return `[Pasted text #${n} - ${b.lineCount} ${linesLabel}]`;
        })
        .join(' ');
    };

    const hasPastedBlocks = Boolean(meta?.pastedBlocks && meta.pastedBlocks.length > 0);
    if (!value.trim() && !hasPastedBlocks) return;

    if (isCommand(value)) {
      const result = await executeCommand(value);
      if (result) {
        const commandMessage: Message = {
          id: createId(),
          role: "slash",
          content: result.content,
          isError: !result.success
        };

        setMessages((prev: Message[]) => [...prev, commandMessage]);

        if (result.shouldAddToHistory !== false) {
          addInputToHistory(value.trim());
        }

        return;
      }
    }

    const composedContent = hasPastedBlocks
      ? `${meta!.pastedBlocks!
        .map((b, i) => `[Pasted text #${i + 1}]\n${b.text}`)
        .join('\n\n')}${value.trim() ? `\n\n${value}` : ''}`
      : value;

    addInputToHistory(value.trim() ? value : (hasPastedBlocks ? buildPastedDisplay(meta!.pastedBlocks!) : value));

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: composedContent,
      displayContent: meta?.pastedBlocks && meta.pastedBlocks.length > 0 ? buildPastedDisplay(meta.pastedBlocks) : (meta?.isPaste ? '[Pasted text]' : undefined),
    };

    setMessages((prev: Message[]) => [...prev, userMessage]);
    setIsProcessing(true);
    setProcessingStartTime(Date.now());
    setCurrentTokens(0);
    shouldAutoScroll.current = true;

    const conversationId = createId();
    const conversationSteps: ConversationStep[] = [];
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let stepCount = 0;
    const historyChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    let totalChars = historyChars + composedContent.length;
    const estimateTokens = () => Math.ceil(totalChars / 4);
    setCurrentTokens(estimateTokens());
    const config = readConfig();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let abortNotified = false;
    const notifyAbort = () => {
      if (abortNotified) return;
      abortNotified = true;
      setMessages((prev: Message[]) => {
        const newMessages = [...prev];
        newMessages.push({
          id: createId(),
          role: "tool",
          success: false,
          content: "Generation aborted. \n↪ What should Mosaic do instead?"
        });
        return newMessages;
      });
    };

    conversationSteps.push({
      type: 'user',
      content: composedContent,
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

      for await (const event of agent.streamMessages(conversationHistory, { abortSignal: abortController.signal })) {
        if (event.type === 'text-delta') {
          assistantChunk += event.content;
          totalChars += event.content.length;
          setCurrentTokens(estimateTokens());

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

          const toolResultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
          totalChars += toolResultStr.length;
          setCurrentTokens(estimateTokens());

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
          if (abortController.signal.aborted) {
            notifyAbort();
            streamHadError = true;
            break;
          }
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
          if (event.usage && event.usage.totalTokens > 0) {
            totalTokens = {
              prompt: event.usage.promptTokens,
              completion: event.usage.completionTokens,
              total: event.usage.totalTokens
            };
            setCurrentTokens(event.usage.totalTokens);
          }
        }
      }

      if (abortController.signal.aborted) {
        notifyAbort();
        return;
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
      if (abortController.signal.aborted) {
        notifyAbort();
        return;
      }
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
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      const duration = processingStartTime ? Date.now() - processingStartTime : null;
      if (duration && duration >= 60000) {
        const blendWord = BLEND_WORDS[Math.floor(Math.random() * BLEND_WORDS.length)];
        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i]?.role === 'assistant') {
              newMessages[i] = { ...newMessages[i]!, responseDuration: duration, blendWord };
              break;
            }
          }
          return newMessages;
        });
      }
      setIsProcessing(false);
      setProcessingStartTime(null);
    }
  };

  if (currentPage === "home") {
    const handleHomeSubmit = (value: string, meta?: InputSubmitMeta) => {
      if (!value.trim() && !(meta?.pastedBlocks && meta.pastedBlocks.length > 0)) return;
      setCurrentPage("chat");
      handleSubmit(value, meta);
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
      processingStartTime={processingStartTime}
      currentTokens={currentTokens}
      scrollOffset={scrollOffset}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
      pasteRequestId={pasteRequestId}
      shortcutsOpen={shortcutsOpen}
      onSubmit={handleSubmit}
    />
  );
}