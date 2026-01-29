import { useState, useEffect, useRef } from "react";
import type { ImagePart, TextPart, UserContent } from "ai";
import { useKeyboard } from "@opentui/react";
import { Agent } from "../agent";
import { saveConversation, addInputToHistory, type ConversationHistory, type ConversationStep } from "../utils/history";
import { readConfig } from "../utils/config";
import { DEFAULT_MAX_TOOL_LINES, formatToolMessage, formatErrorMessage, parseToolHeader } from '../utils/toolFormatting';
import { initializeCommands, isCommand, executeCommand } from '../utils/commands';
import type { InputSubmitMeta } from './CustomInput';

import { subscribeQuestion, type QuestionRequest } from "../utils/questionBridge";
import { subscribeApprovalAccepted, type ApprovalAccepted } from "../utils/approvalBridge";
import { setExploreAbortController, setExploreToolCallback, abortExplore } from "../utils/exploreBridge";
import { getCurrentQuestion, cancelQuestion } from "../utils/questionBridge";
import { getCurrentApproval, cancelApproval } from "../utils/approvalBridge";
import { BLEND_WORDS, type MainProps, type Message } from "./main/types";
import { HomePage } from './main/HomePage';
import { ChatPage } from './main/ChatPage';
import type { ImageAttachment } from "../utils/images";
import { subscribeImageCommand, setImageSupport } from "../utils/imageBridge";
import { findModelsDevModelById, modelAcceptsImages, getModelsDevContextLimit } from "../utils/models";
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from "../agent/prompts/systemPrompt";

type CompactableMessage = Pick<Message, "role" | "content" | "thinkingContent" | "toolName">;

function extractTitle(content: string, alreadyResolved: boolean): { title: string | null; cleanContent: string; isPending: boolean; noTitle: boolean } {
  const trimmed = content.trimStart();

  const titleMatch = trimmed.match(/^<title>(.*?)<\/title>\s*/s);
  if (titleMatch) {
    const title = alreadyResolved ? null : (titleMatch[1]?.trim() || null);
    const cleanContent = trimmed.replace(/^<title>.*?<\/title>\s*/s, '');
    return { title, cleanContent, isPending: false, noTitle: false };
  }

  if (alreadyResolved) {
    return { title: null, cleanContent: content, isPending: false, noTitle: false };
  }

  const partialTitlePattern = /^<(t(i(t(l(e(>.*)?)?)?)?)?)?$/i;
  if (partialTitlePattern.test(trimmed) || (trimmed.startsWith('<title>') && !trimmed.includes('</title>'))) {
    return { title: null, cleanContent: '', isPending: true, noTitle: false };
  }

  return { title: null, cleanContent: content, isPending: false, noTitle: true };
}

function setTerminalTitle(title: string) {
  process.title = `⁘ ${title}`;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + "...";
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTokensForMessage(message: CompactableMessage): number {
  const contentTokens = estimateTokensFromText(message.content || "");
  const thinkingTokens = estimateTokensFromText(message.thinkingContent || "");
  return contentTokens + thinkingTokens + 4;
}

export function estimateTokensForMessages(messages: CompactableMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokensForMessage(message), 0);
}

export function estimateTotalTokens(messages: CompactableMessage[], systemPrompt: string): number {
  const systemTokens = estimateTokensFromText(systemPrompt) + 8;
  return systemTokens + estimateTokensForMessages(messages);
}

export function shouldAutoCompact(totalTokens: number, maxContextTokens: number): boolean {
  if (!Number.isFinite(maxContextTokens) || maxContextTokens <= 0) return false;
  const threshold = Math.floor(maxContextTokens * 0.95);
  return totalTokens >= threshold;
}

export function summarizeMessage(message: CompactableMessage, maxChars: number): string {
  if (message.role === "tool") {
    const name = message.toolName || "tool";
    const cleaned = normalizeWhitespace(message.content || "");
    return `tool ${name}: ${truncateText(cleaned, maxChars)}`;
  }
  const cleaned = normalizeWhitespace(message.content || "");
  return `${message.role}: ${truncateText(cleaned, maxChars)}`;
}

export function buildSummary(messages: CompactableMessage[], maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4);
  const lines: string[] = [];
  for (const message of messages) {
    if (lines.join("\n").length >= maxChars) break;
    lines.push(`- ${summarizeMessage(message, 240)}`);
  }
  const body = lines.join("\n");
  const header = "Résumé de conversation (compact):";
  const full = `${header}\n${body}`.trim();
  return truncateText(full, maxChars);
}

export function collectContextFiles(messages: Message[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    if (!message.toolArgs) continue;
    const toolName = message.toolName || "";
    if (!["read", "write", "edit", "list", "grep"].includes(toolName)) continue;
    const path = message.toolArgs.path;
    if (typeof path === "string" && path.trim()) {
      files.add(path.trim());
    }
    const pattern = message.toolArgs.pattern;
    if (toolName === "grep" && typeof pattern === "string" && pattern.trim()) {
      files.add(pattern.trim());
    }
  }
  return Array.from(files.values()).sort((a, b) => a.localeCompare(b));
}

export function appendContextFiles(summary: string, files: string[], maxTokens: number): string {
  if (files.length === 0) return summary;
  const maxChars = Math.max(0, maxTokens * 4);
  const list = files.map(f => `- ${f}`).join("\n");
  const block = `\n\nFichiers conservés après compaction:\n${list}`;
  return truncateText(`${summary}${block}`, maxChars);
}

export function compactMessagesForUi(
  messages: Message[],
  systemPrompt: string,
  maxContextTokens: number,
  createId: () => string,
  summaryOnly: boolean
): { messages: Message[]; estimatedTokens: number; didCompact: boolean } {
  const systemTokens = estimateTokensFromText(systemPrompt) + 8;
  const totalTokens = systemTokens + estimateTokensForMessages(messages);
  if (totalTokens <= maxContextTokens && !summaryOnly) {
    return { messages, estimatedTokens: totalTokens - systemTokens, didCompact: false };
  }

  const summaryTokens = Math.min(2000, Math.max(400, Math.floor(maxContextTokens * 0.2)));
  const recentBudget = Math.max(500, maxContextTokens - summaryTokens);

  let recentTokens = 0;
  const recent: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const msgTokens = estimateTokensForMessage(message);
    if (recentTokens + msgTokens > recentBudget && recent.length > 0) break;
    recent.unshift(message);
    recentTokens += msgTokens;
  }

  const cutoff = messages.length - recent.length;
  const older = cutoff > 0 ? messages.slice(0, cutoff) : [];
  const files = collectContextFiles(messages);
  const summaryBase = buildSummary(summaryOnly ? messages : (older.length > 0 ? older : messages), summaryTokens);
  const summary = appendContextFiles(summaryBase, files, summaryTokens);
  const summaryMessage: Message = {
    id: createId(),
    role: "assistant",
    content: summary
  };

  const nextMessages = summaryOnly ? [summaryMessage] : [summaryMessage, ...recent];
  const estimatedTokens = estimateTokensForMessages(nextMessages);
  return { messages: nextMessages, estimatedTokens, didCompact: true };
}

export function Main({ pasteRequestId = 0, copyRequestId = 0, onCopy, shortcutsOpen = false, commandsOpen = false, initialMessage }: MainProps) {
  const [currentPage, setCurrentPage] = useState<"home" | "chat">(initialMessage ? "chat" : "home");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(process.stdout.rows || 24);
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [imagesSupported, setImagesSupported] = useState(false);
  const currentTitleRef = useRef<string | null>(null);
  const titleExtractedRef = useRef(false);
  const shouldAutoScroll = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentPageRef = useRef(currentPage);
  const shortcutsOpenRef = useRef(shortcutsOpen);
  const commandsOpenRef = useRef(commandsOpen);
  const questionRequestRef = useRef<QuestionRequest | null>(questionRequest);
  const initialMessageProcessed = useRef(false);
  const exploreMessageIdRef = useRef<string | null>(null);
  const exploreToolsRef = useRef<Array<{ tool: string; info: string; success: boolean }>>([]);
  const explorePurposeRef = useRef<string>('');

  const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  useEffect(() => {
    initializeCommands();
  }, []);

  useEffect(() => {
    const loadSupport = async () => {
      const config = readConfig();
      if (!config.model) {
        setImagesSupported(false);
        setImageSupport(false);
        return;
      }
      try {
        const result = await findModelsDevModelById(config.model);
        const supported = Boolean(result && result.model && modelAcceptsImages(result.model));
        setImagesSupported(supported);
        setImageSupport(supported);
      } catch {
        setImagesSupported(false);
        setImageSupport(false);
      }
    };
    loadSupport();
  }, []);

  useEffect(() => {
    let lastExploreTokens = 0;
    setExploreToolCallback((toolName, args, result, totalTokens) => {
      const info = (args.path || args.pattern || args.query || '') as string;
      const shortInfo = info.length > 40 ? info.substring(0, 37) + '...' : info;
      exploreToolsRef.current.push({ tool: toolName, info: shortInfo, success: result.success });

      const tokenDelta = totalTokens - lastExploreTokens;
      lastExploreTokens = totalTokens;
      if (tokenDelta > 0) {
        setCurrentTokens(prev => prev + tokenDelta);
      }

      if (exploreMessageIdRef.current) {
        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          const idx = newMessages.findIndex(m => m.id === exploreMessageIdRef.current);
          if (idx !== -1) {
            const toolLines = exploreToolsRef.current.map(t => {
              const icon = t.success ? '→' : '-';
              return `  ${icon} ${t.tool}(${t.info})`;
            });
            const purpose = explorePurposeRef.current;
            const newContent = `Explore (${purpose})\n${toolLines.join('\n')}`;
            newMessages[idx] = { ...newMessages[idx]!, content: newContent };
          }
          return newMessages;
        });
      }
    });

    return () => {
      setExploreToolCallback(null);
    };
  }, []);

  useEffect(() => {
    return subscribeImageCommand((event) => {
      if (event.type === "clear") {
        setPendingImages([]);
        return;
      }
      if (event.type === "remove") {
        setPendingImages((prev) => prev.filter((img) => img.id !== event.id));
        return;
      }
      if (!imagesSupported) return;
      setPendingImages((prev) => [...prev, event.image]);
    });
  }, [imagesSupported]);

  useEffect(() => {
    if (!imagesSupported) {
      setPendingImages([]);
    }
  }, [imagesSupported]);

  useEffect(() => {
    const handleResize = () => {
      const newWidth = process.stdout.columns || 80;
      const newHeight = process.stdout.rows || 24;
      const oldWidth = terminalWidth;
      const oldHeight = terminalHeight;

      setTerminalWidth(newWidth);
      setTerminalHeight(newHeight);

      if (shouldAutoScroll.current) {
        setScrollOffset(0);
      } else if (oldHeight !== newHeight) {
        const heightDiff = newHeight - oldHeight;
        setScrollOffset(prev => Math.max(0, prev - heightDiff));
      }
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [terminalWidth, terminalHeight]);

  useEffect(() => {
    return subscribeQuestion(setQuestionRequest);
  }, []);

  useEffect(() => {
    return subscribeApprovalAccepted((accepted) => {
      const isBashTool = accepted.toolName === 'bash';

      if (isBashTool) {
        const { name: toolDisplayName, info: toolInfo } = parseToolHeader(accepted.toolName, accepted.args);
        const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          newMessages.push({
            id: createId(),
            role: "tool",
            content: runningContent,
            toolName: accepted.toolName,
            toolArgs: accepted.args,
            success: true,
            isRunning: true,
            runningStartTime: Date.now()
          });
          return newMessages;
        });
      }
    });
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
    if (questionRequest) {
      shouldAutoScroll.current = true;
      setScrollOffset(0);
    }
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
    if ((key.name === 'c' && key.ctrl) || key.sequence === '\x03') {
      if (getCurrentQuestion()) {
        cancelQuestion();
      }
      if (getCurrentApproval()) {
        cancelApproval();
      }
      abortControllerRef.current?.abort();
      return;
    }

    if (key.name === 'escape') {
      if (getCurrentQuestion()) {
        cancelQuestion();
      }
      if (getCurrentApproval()) {
        cancelApproval();
      }
      abortControllerRef.current?.abort();
      return;
    }
  });

  const buildUserContent = (text: string, images?: ImageAttachment[]): UserContent => {
    if (!images || images.length === 0) return text;
    const parts: Array<TextPart | ImagePart> = [];
    parts.push({ type: "text", text });
    for (const img of images) {
      parts.push({ type: "image", image: img.data, mimeType: img.mimeType });
    }
    return parts;
  };

  const buildConversationHistory = (base: Message[], includeImages: boolean) => {
    return base
      .filter((m): m is Message & { role: "user" | "assistant" } => m.role === "user" || m.role === "assistant")
      .map((m) => {
        if (m.role === "user") {
          const content = includeImages ? buildUserContent(m.content, m.images) : m.content;
          return { role: "user" as const, content };
        }
        return { role: "assistant" as const, content: m.content };
      });
  };

  const handleSubmit = async (value: string, meta?: InputSubmitMeta) => {
    if (isProcessing) return;

    const hasPastedContent = Boolean(meta?.isPaste && meta.pastedContent);
    const hasImages = imagesSupported && pendingImages.length > 0;
    if (!value.trim() && !hasPastedContent && !hasImages) return;

    if (isCommand(value)) {
      const result = await executeCommand(value);
      if (result) {
        if (result.shouldClearMessages === true) {
          const commandMessage: Message = {
            id: createId(),
            role: "slash",
            content: result.content,
            isError: !result.success
          };
          setMessages([commandMessage]);
          return;
        }

        if (result.shouldCompactMessages === true) {
          const config = readConfig();
          const rawSystemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
          const systemPrompt = processSystemPrompt(rawSystemPrompt, true);
          let maxContextTokens = result.compactMaxTokens ?? config.maxContextTokens;
          if (!maxContextTokens && config.provider && config.model) {
            const resolved = await getModelsDevContextLimit(config.provider, config.model);
            if (typeof resolved === "number") {
              maxContextTokens = resolved;
            }
          }
          const targetTokens = maxContextTokens ?? 12000;
          let nextTokens = currentTokens;
          setMessages(prev => {
            const compacted = compactMessagesForUi(prev, systemPrompt, targetTokens, createId, true);
            nextTokens = compacted.estimatedTokens;
            return compacted.messages;
          });
          setCurrentTokens(nextTokens);
          return;
        }
        
        if (result.shouldAddToHistory === true) {
          addInputToHistory(value.trim());

          const userMessage: Message = {
            id: createId(),
            role: "user",
            content: result.content,
            displayContent: value,
          };

          setMessages((prev: Message[]) => [...prev, userMessage]);
          setIsProcessing(true);
          const localStartTime = Date.now();
          setProcessingStartTime(localStartTime);
          setCurrentTokens(0);
          shouldAutoScroll.current = true;

          const conversationId = createId();
          const conversationSteps: ConversationStep[] = [];
          let totalTokens = { prompt: 0, completion: 0, total: 0 };
          let stepCount = 0;
          let totalChars = 0;
          for (const m of messages) {
            if (m.role === 'assistant') {
              totalChars += m.content.length;
              if (m.thinkingContent) totalChars += m.thinkingContent.length;
            } else if (m.role === 'tool') {
              totalChars += m.content.length;
            }
          }

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
                content: "Request interrupted by user. \n↪ What should Mosaic do instead?"
              });
              return newMessages;
            });
          };

          conversationSteps.push({
            type: 'user',
            content: result.content,
            timestamp: Date.now()
          });

          let responseDuration: number | null = null;
          let responseBlendWord: string | null = null;

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
            const conversationHistory = buildConversationHistory([...messages, userMessage], imagesSupported);
            let assistantChunk = '';
            let thinkingChunk = '';
            const pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown>; messageId?: string }>();
            let assistantMessageId: string | null = null;
            let streamHadError = false;
            titleExtractedRef.current = false;

            for await (const event of agent.streamMessages(conversationHistory, { abortSignal: abortController.signal })) {
              if (event.type === 'reasoning-delta') {
                thinkingChunk += event.content;
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
                    newMessages.push({ id: currentMessageId, role: "assistant", content: '', thinkingContent: thinkingChunk });
                  } else {
                    newMessages[messageIndex] = {
                      ...newMessages[messageIndex]!,
                      thinkingContent: thinkingChunk
                    };
                  }
                  return newMessages;
                });
              } else if (event.type === 'text-delta') {
                assistantChunk += event.content;
                totalChars += event.content.length;
                setCurrentTokens(estimateTokens());

                const { title, cleanContent, isPending, noTitle } = extractTitle(assistantChunk, titleExtractedRef.current);

                if (title) {
                  titleExtractedRef.current = true;
                  currentTitleRef.current = title;
                  setCurrentTitle(title);
                  setTerminalTitle(title);
                } else if (noTitle) {
                  titleExtractedRef.current = true;
                }

                if (isPending) continue;

                if (assistantMessageId === null) {
                  assistantMessageId = createId();
                }

                const displayContent = cleanContent;
                const currentMessageId = assistantMessageId;
                setMessages((prev: Message[]) => {
                  const newMessages = [...prev];
                  const messageIndex = newMessages.findIndex(m => m.id === currentMessageId);

                  if (messageIndex === -1) {
                    newMessages.push({ id: currentMessageId, role: "assistant", content: displayContent, thinkingContent: thinkingChunk });
                  } else {
                    newMessages[messageIndex] = {
                      ...newMessages[messageIndex]!,
                      content: displayContent
                    };
                  }
                  return newMessages;
                });
              } else if (event.type === 'step-start') {
                stepCount++;
              } else if (event.type === 'tool-call-end') {
                totalChars += JSON.stringify(event.args).length;
                setCurrentTokens(estimateTokens());

                const needsApproval = event.toolName === 'write' || event.toolName === 'edit' || event.toolName === 'bash';
                const isExploreTool = event.toolName === 'explore';
                const showRunning = event.toolName === 'bash';
                let runningMessageId: string | undefined;

                if (isExploreTool) {
                  setExploreAbortController(abortController);
                  exploreToolsRef.current = [];
                  const purpose = (event.args.purpose as string) || 'exploring...';
                  explorePurposeRef.current = purpose;
                }

                if (!needsApproval) {
                  runningMessageId = createId();
                  const { name: toolDisplayName, info: toolInfo } = parseToolHeader(event.toolName, event.args);
                  const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

                  if (isExploreTool) {
                    exploreMessageIdRef.current = runningMessageId;
                  }

                  setMessages((prev: Message[]) => {
                    const newMessages = [...prev];
                    newMessages.push({
                      id: runningMessageId!,
                      role: "tool",
                      content: runningContent,
                      toolName: event.toolName,
                      toolArgs: event.args,
                      success: true,
                      isRunning: showRunning || isExploreTool,
                      runningStartTime: (showRunning || isExploreTool) ? Date.now() : undefined
                    });
                    return newMessages;
                  });
                }

                pendingToolCalls.set(event.toolCallId, {
                  toolName: event.toolName,
                  args: event.args,
                  messageId: runningMessageId
                });

              } else if (event.type === 'tool-result') {
                const pending = pendingToolCalls.get(event.toolCallId);
                const toolName = pending?.toolName ?? event.toolName;
                const toolArgs = pending?.args ?? {};
                const runningMessageId = pending?.messageId;
                pendingToolCalls.delete(event.toolCallId);

                if (toolName === 'explore') {
                  exploreMessageIdRef.current = null;
                  setExploreAbortController(null);
                }

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

                  let runningIndex = -1;
                  if (runningMessageId) {
                    runningIndex = newMessages.findIndex(m => m.id === runningMessageId);
                  } else if (toolName === 'bash' || toolName === 'explore') {
                    runningIndex = newMessages.findIndex(m => m.toolName === toolName && m.isRunning === true);
                  }

                  if (runningIndex !== -1) {
                    newMessages[runningIndex] = {
                      ...newMessages[runningIndex]!,
                      content: toolContent,
                      toolArgs: toolArgs,
                      toolResult: event.result,
                      success,
                      isRunning: false,
                      runningStartTime: undefined,
                      timestamp: Date.now()
                    };
                    return newMessages;
                  }

                  newMessages.push({
                    id: createId(),
                    role: "tool",
                    content: toolContent,
                    toolName,
                    toolArgs: toolArgs,
                    toolResult: event.result,
                    success: success,
                    timestamp: Date.now()
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

                const errorContent = formatErrorMessage('API', event.error);
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

            responseDuration = Date.now() - localStartTime;
            if (responseDuration >= 60000) {
              responseBlendWord = BLEND_WORDS[Math.floor(Math.random() * BLEND_WORDS.length)];
              for (let i = conversationSteps.length - 1; i >= 0; i--) {
                if (conversationSteps[i]?.type === 'assistant') {
                  conversationSteps[i] = {
                    ...conversationSteps[i]!,
                    responseDuration,
                    blendWord: responseBlendWord
                  };
                  break;
                }
              }
            }

            const conversationData: ConversationHistory = {
              id: conversationId,
              timestamp: Date.now(),
              steps: conversationSteps,
              totalSteps: stepCount,
              title: currentTitleRef.current ?? currentTitle ?? null,
              workspace: process.cwd(),
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
            const errorContent = formatErrorMessage('Mosaic', errorMessage);
            setMessages((prev: Message[]) => {
              const newMessages = [...prev];
              if (newMessages[newMessages.length - 1]?.role === 'assistant' && newMessages[newMessages.length - 1]?.content === '') {
                newMessages[newMessages.length - 1] = {
                  id: newMessages[newMessages.length - 1]!.id,
                  role: "assistant",
                  content: errorContent,
                  isError: true
                };
              } else {
                newMessages.push({
                  id: createId(),
                  role: "assistant",
                  content: errorContent,
                  isError: true
                });
              }
              return newMessages;
            });
          } finally {
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
            const duration = responseDuration ?? (Date.now() - localStartTime);
            if (duration >= 60000) {
              const blendWord = responseBlendWord ?? BLEND_WORDS[Math.floor(Math.random() * BLEND_WORDS.length)];
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

          return;
        }

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

    const composedContent = hasPastedContent
      ? `${meta!.pastedContent!}${value.trim() ? `\n\n${value}` : ''}`
      : value;

    addInputToHistory(value.trim() || (hasPastedContent ? '[Pasted text]' : (hasImages ? '[Image]' : value)));

    const imagesForMessage = imagesSupported ? pendingImages : [];

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: composedContent,
      displayContent: meta?.isPaste ? '[Pasted text]' : undefined,
      images: imagesForMessage.length > 0 ? imagesForMessage : undefined,
    };

    if (imagesForMessage.length > 0) {
      setPendingImages([]);
    }

    setMessages((prev: Message[]) => [...prev, userMessage]);
    setIsProcessing(true);
    const localStartTime = Date.now();
    setProcessingStartTime(localStartTime);
    setCurrentTokens(0);
    shouldAutoScroll.current = true;

    const conversationId = createId();
    const conversationSteps: ConversationStep[] = [];
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let stepCount = 0;
    let totalChars = 0;
    for (const m of messages) {
      if (m.role === 'assistant') {
        totalChars += m.content.length;
        if (m.thinkingContent) totalChars += m.thinkingContent.length;
      } else if (m.role === 'tool') {
        totalChars += m.content.length;
      }
    }

    const estimateTokens = () => Math.ceil(totalChars / 4);
    setCurrentTokens(estimateTokens());
    const config = readConfig();
    const resolveMaxContextTokens = async () => {
      if (config.maxContextTokens) return config.maxContextTokens;
      if (config.provider && config.model) {
        const resolved = await getModelsDevContextLimit(config.provider, config.model);
        if (typeof resolved === "number") return resolved;
      }
      return undefined;
    };
    const buildSystemPrompt = () => {
      const rawSystemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      return processSystemPrompt(rawSystemPrompt, true);
    };
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
      timestamp: Date.now(),
      images: imagesForMessage.length > 0 ? imagesForMessage : undefined
    });

          let responseDuration: number | null = null;
          let responseBlendWord: string | null = null;

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
      const conversationHistory = buildConversationHistory([...messages, userMessage], imagesSupported);
      let assistantChunk = '';
      let thinkingChunk = '';
      const pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown>; messageId?: string }>();
      let assistantMessageId: string | null = null;
      let streamHadError = false;
      titleExtractedRef.current = false;

      for await (const event of agent.streamMessages(conversationHistory, { abortSignal: abortController.signal })) {
        if (event.type === 'reasoning-delta') {
          thinkingChunk += event.content;
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
              newMessages.push({ id: currentMessageId, role: "assistant", content: '', thinkingContent: thinkingChunk });
            } else {
              newMessages[messageIndex] = {
                ...newMessages[messageIndex]!,
                thinkingContent: thinkingChunk
              };
            }
            return newMessages;
          });
        } else if (event.type === 'text-delta') {
          assistantChunk += event.content;
          totalChars += event.content.length;
          setCurrentTokens(estimateTokens());

          const { title, cleanContent, isPending, noTitle } = extractTitle(assistantChunk, titleExtractedRef.current);

          if (title) {
            titleExtractedRef.current = true;
            currentTitleRef.current = title;
            setCurrentTitle(title);
            setTerminalTitle(title);
          } else if (noTitle) {
            titleExtractedRef.current = true;
          }

          if (isPending) continue;

          if (assistantMessageId === null) {
            assistantMessageId = createId();
          }

          const displayContent = cleanContent;
          const currentMessageId = assistantMessageId;
          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            const messageIndex = newMessages.findIndex(m => m.id === currentMessageId);

            if (messageIndex === -1) {
              newMessages.push({ id: currentMessageId, role: "assistant", content: displayContent, thinkingContent: thinkingChunk });
            } else {
              newMessages[messageIndex] = {
                ...newMessages[messageIndex]!,
                content: displayContent,
                thinkingContent: thinkingChunk
              };
            }
            return newMessages;
          });
        } else if (event.type === 'step-start') {
          stepCount++;
        } else if (event.type === 'tool-call-end') {
          totalChars += JSON.stringify(event.args).length;
          setCurrentTokens(estimateTokens());

          const isExploreTool = event.toolName === 'explore';
          let runningMessageId: string | undefined;

          if (isExploreTool) {
            setExploreAbortController(abortController);
            exploreToolsRef.current = [];
            const purpose = (event.args.purpose as string) || 'exploring...';
            explorePurposeRef.current = purpose;
            runningMessageId = createId();
            exploreMessageIdRef.current = runningMessageId;
            const { name: toolDisplayName, info: toolInfo } = parseToolHeader(event.toolName, event.args);
            const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

            setMessages((prev: Message[]) => {
              const newMessages = [...prev];
              newMessages.push({
                id: runningMessageId!,
                role: "tool",
                content: runningContent,
                toolName: event.toolName,
                toolArgs: event.args,
                success: true,
                isRunning: true,
                runningStartTime: Date.now()
              });
              return newMessages;
            });
          }

          pendingToolCalls.set(event.toolCallId, {
            toolName: event.toolName,
            args: event.args,
            messageId: runningMessageId
          });

        } else if (event.type === 'tool-result') {
          const pending = pendingToolCalls.get(event.toolCallId);
          const toolName = pending?.toolName ?? event.toolName;
          const toolArgs = pending?.args ?? {};
          const runningMessageId = pending?.messageId;
          pendingToolCalls.delete(event.toolCallId);

          if (toolName === 'explore') {
            exploreMessageIdRef.current = null;
            setExploreAbortController(null);
          }

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

            let runningIndex = -1;
            if (runningMessageId) {
              runningIndex = newMessages.findIndex(m => m.id === runningMessageId);
            } else if (toolName === 'bash' || toolName === 'explore') {
              runningIndex = newMessages.findIndex(m => m.isRunning && m.toolName === toolName);
            }

            if (runningIndex !== -1) {
              newMessages[runningIndex] = {
                ...newMessages[runningIndex]!,
                content: toolContent,
                toolArgs: toolArgs,
                toolResult: event.result,
                success,
                isRunning: false,
                runningStartTime: undefined
              };
              return newMessages;
            }

            newMessages.push({
              id: createId(),
              role: "tool",
              content: toolContent,
              toolName,
              toolArgs: toolArgs,
              toolResult: event.result,
              success: success
            });
            return newMessages;
          });

          assistantChunk = '';
          thinkingChunk = '';
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

          const errorContent = formatErrorMessage('API', event.error);
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
          thinkingChunk = '';
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

          responseDuration = Date.now() - localStartTime;
          if (responseDuration >= 60000) {
            responseBlendWord = BLEND_WORDS[Math.floor(Math.random() * BLEND_WORDS.length)];
            for (let i = conversationSteps.length - 1; i >= 0; i--) {
              if (conversationSteps[i]?.type === 'assistant') {
                conversationSteps[i] = {
                  ...conversationSteps[i]!,
                  responseDuration,
                  blendWord: responseBlendWord
                };
                break;
              }
            }
          }

          const conversationData: ConversationHistory = {
            id: conversationId,
            timestamp: Date.now(),
            steps: conversationSteps,
            totalSteps: stepCount,
            title: currentTitleRef.current ?? currentTitle ?? null,
            workspace: process.cwd(),
            totalTokens: totalTokens.total > 0 ? totalTokens : undefined,
            model: config.model,
            provider: config.provider
          };

          saveConversation(conversationData);
          const maxContextTokens = await resolveMaxContextTokens();
          if (!abortController.signal.aborted && maxContextTokens) {
            const systemPrompt = buildSystemPrompt();
            setMessages(prev => {
              const totalTokens = estimateTotalTokens(prev, systemPrompt);
              if (!shouldAutoCompact(totalTokens, maxContextTokens)) return prev;
              const compacted = compactMessagesForUi(prev, systemPrompt, maxContextTokens, createId, true);
              setCurrentTokens(compacted.estimatedTokens);
              return compacted.messages;
            });
          }

    } catch (error) {
      if (abortController.signal.aborted) {
        notifyAbort();
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      const errorContent = formatErrorMessage('Mosaic', errorMessage);
      setMessages((prev: Message[]) => {
        const newMessages = [...prev];
        if (newMessages[newMessages.length - 1]?.role === 'assistant' && newMessages[newMessages.length - 1]?.content === '') {
          newMessages[newMessages.length - 1] = {
            id: newMessages[newMessages.length - 1]!.id,
            role: "assistant",
            content: errorContent,
            isError: true
          };
        } else {
          newMessages.push({
            id: createId(),
            role: "assistant",
            content: errorContent,
            isError: true
          });
        }
        return newMessages;
      });
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      const duration = responseDuration ?? (Date.now() - localStartTime);
      if (duration >= 60000) {
        const blendWord = responseBlendWord ?? BLEND_WORDS[Math.floor(Math.random() * BLEND_WORDS.length)];
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

  useEffect(() => {
    if (initialMessage && !initialMessageProcessed.current && currentPage === "chat") {
      initialMessageProcessed.current = true;
      handleSubmit(initialMessage);
    }
  }, [initialMessage, currentPage, handleSubmit]);

  if (currentPage === "home") {
    const handleHomeSubmit = (value: string, meta?: InputSubmitMeta) => {
      const hasPastedContent = Boolean(meta?.isPaste && meta.pastedContent);
      if (!value.trim() && !hasPastedContent) return;
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
      pendingImages={pendingImages}
    />
  );
}
