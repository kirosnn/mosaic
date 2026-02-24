import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { addInputToHistory } from "../utils/history";
import { readConfig } from "../utils/config";

import { DEFAULT_MAX_TOOL_LINES, formatToolMessage, parseToolHeader, getExploreToolInfo } from '../utils/toolFormatting';
import { initializeCommands, isCommand, executeCommand } from '../utils/commands';
import type { InputSubmitMeta } from './CustomInput';

import { subscribeQuestion, type QuestionRequest } from "../utils/questionBridge";
import { subscribeApprovalAccepted } from "../utils/approvalBridge";
import { setExploreToolCallback } from "../utils/exploreBridge";
import { getCurrentQuestion, cancelQuestion } from "../utils/questionBridge";
import { getCurrentApproval, cancelApproval } from "../utils/approvalBridge";
import { type MainProps, type Message, type TokenBreakdown } from "./main/types";
import { setTerminalTitle } from "./main/titleUtils";
import { buildCompactionDisplay, compactMessagesForUi, estimateTotalTokens } from "./main/compaction";
import { runAgentStream, type AgentStreamCallbacks } from "./main/useAgentStream";
import { HomePage } from './main/HomePage';
import { ChatPage } from './main/ChatPage';
import type { ImageAttachment } from "../utils/images";
import { subscribeImageCommand, setImageSupport } from "../utils/imageBridge";
import { findModelsDevModelById, modelAcceptsImages, getModelsDevContextLimit } from "../utils/models";
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from "../agent/prompts/systemPrompt";
import { getDefaultContextBudget } from "../utils/tokenEstimator";
import { debugLog } from "../utils/debug";
import { executeTool } from "../agent/tools/executor";
import { Agent } from "../agent";
import { buildSmartConversationHistory } from "../agent/context";
import { subscribePendingChanges, subscribeReviewMode, getCurrentReviewChange, getReviewProgress, respondReview, acceptAllReview, type PendingChange } from "../utils/pendingChangesBridge";
import { ReviewPanel } from "./main/ReviewPanel";
import { revertChange } from "../utils/revertChanges";
import { CommandSelectMenu } from "./main/CommandSelectMenu";
import type { CommandExecutionContext, SelectOption } from "../utils/commands/types";

export function Main({ pasteRequestId = 0, copyRequestId = 0, onCopy, shortcutsOpen = false, commandsOpen = false, initialMessage, initialMessages, initialTitle }: MainProps) {
  const hasRestoredSession = Boolean(initialMessages && initialMessages.length > 0);
  const [currentPage, setCurrentPage] = useState<"home" | "chat">(initialMessage || hasRestoredSession ? "chat" : "home");
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [tokenBreakdown, setTokenBreakdown] = useState<TokenBreakdown>({ prompt: 0, reasoning: 0, output: 0, tools: 0 });
  const [chatError, setChatErrorState] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalHeight, setTerminalHeight] = useState(process.stdout.rows || 24);
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(initialTitle ?? null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [imagesSupported, setImagesSupported] = useState(false);
  const [selectMenu, setSelectMenu] = useState<{ title: string; options: SelectOption[]; onSelect: (value: string) => void } | null>(null);
  const currentTitleRef = useRef<string | null>(initialTitle ?? null);
  const lastAppliedTerminalTitleRef = useRef<string | null>(null);
  const titleExtractedRef = useRef(false);
  const shouldAutoScroll = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentPageRef = useRef(currentPage);
  const shortcutsOpenRef = useRef(shortcutsOpen);
  const commandsOpenRef = useRef(commandsOpen);
  const questionRequestRef = useRef<QuestionRequest | null>(questionRequest);
  const initialMessageProcessed = useRef(false);
  const lastPromptTokensRef = useRef<number>(0);
  const exploreMessageIdRef = useRef<string | null>(null);

  const exploreToolsRef = useRef<Array<{ tool: string; info: string; success: boolean }>>([]);
  const explorePurposeRef = useRef<string>('');
  const disposedRef = useRef(false);
  const pendingCompactTokensRef = useRef<number | null>(null);
  const terminalHeightRef = useRef(process.stdout.rows || 24);

  const chatModalOpenRef = useRef(false);
  const handleChatModalOpenChange = useCallback((open: boolean) => {
    chatModalOpenRef.current = open;
  }, []);

  const [isReviewMode, setIsReviewMode] = useState(false);
  const [currentReviewChange, setCurrentReviewChange] = useState<PendingChange | null>(null);
  const [reviewProgress, setReviewProgress] = useState({ current: 0, total: 0 });
  const pendingChangesRef = useRef<PendingChange[]>([]);

  const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const toLogPreview = (value: string, max = 1200) => {
    const normalized = value
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/"/g, "'");
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 3))}...`;
  };

  function setChatError(value: string | null) {
    setChatErrorState(value);
    if (!value) return;
    const text = value.trim();
    if (!text) return;
    const message: Message = {
      id: createId(),
      role: "assistant",
      content: text,
      isError: true,
    };
    setMessages((prev: Message[]) => [...prev, message]);
  }

  useEffect(() => {
    initializeCommands();
  }, []);

  useEffect(() => {
    if (currentTitle && currentTitleRef.current !== currentTitle) {
      currentTitleRef.current = currentTitle;
    }
  }, [currentTitle]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (disposedRef.current) return;
      const desired = (currentTitleRef.current ?? currentTitle ?? '').trim();
      if (!desired) return;

      setTerminalTitle(desired);
      lastAppliedTerminalTitleRef.current = desired;
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [currentTitle]);

  useEffect(() => {
    return () => { disposedRef.current = true; };
  }, []);

  useEffect(() => {
    return subscribePendingChanges((changes) => {
      pendingChangesRef.current = changes;
    });
  }, []);

  useEffect(() => {
    return subscribeReviewMode((reviewing) => {
      setIsReviewMode(reviewing);
      if (reviewing) {
        setCurrentReviewChange(getCurrentReviewChange());
        setReviewProgress(getReviewProgress());
      } else {
        setCurrentReviewChange(null);
        setReviewProgress({ current: 0, total: 0 });
      }
    });
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
      const info = getExploreToolInfo(toolName, args);
      const shortInfo = info.length > 40 ? info.substring(0, 37) + '...' : info;
      exploreToolsRef.current.push({ tool: toolName, info: shortInfo, success: result.success });

      const tokenDelta = totalTokens - lastExploreTokens;
      lastExploreTokens = totalTokens;
      if (tokenDelta > 0) {
        setCurrentTokens(prev => prev + tokenDelta);
        setTokenBreakdown(prev => ({ ...prev, tools: prev.tools + tokenDelta }));
      }

      if (exploreMessageIdRef.current) {
        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          const idx = newMessages.findIndex(m => m.id === exploreMessageIdRef.current);
          if (idx !== -1) {
            const toolLines = exploreToolsRef.current.map(t => {
              const icon = t.success ? '➔ ' : '-';
              return t.info ? `  ${icon} ${t.tool}(${t.info})` : `  ${icon} ${t.tool}`;
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
      const oldHeight = terminalHeightRef.current;
      terminalHeightRef.current = newHeight;

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
  }, []);

  useEffect(() => {
    return subscribeQuestion(setQuestionRequest);
  }, []);

  useEffect(() => {
    return subscribeApprovalAccepted((accepted) => {
      const isBashTool = accepted.toolName === 'bash';
      const isMcpTool = accepted.toolName.startsWith('mcp__');

      if (isBashTool || isMcpTool) {
        const { name: toolDisplayName, info: toolInfo } = parseToolHeader(accepted.toolName, accepted.args);
        const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

        setMessages((prev: Message[]) => {
          const newMessages = [...prev];

          if (isMcpTool) {
            const existingIdx = newMessages.findIndex(m => m.isRunning && m.toolName === accepted.toolName);
            if (existingIdx !== -1) {
              newMessages[existingIdx] = {
                ...newMessages[existingIdx]!,
                content: runningContent,
                runningStartTime: Date.now()
              };
              return newMessages;
            }
          }

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
            setScrollOffset((prev) => prev + 3);
          } else if (button === 65) {
            setScrollOffset((prev) => {
              const newOffset = Math.max(0, prev - 3);
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
    if (shortcutsOpenRef.current || commandsOpenRef.current || chatModalOpenRef.current) {
      if (key.name === 'escape') return;
    }

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

  const buildConversationHistory = (base: Message[], includeImages: boolean) => {
    const config = readConfig();
    const maxContextTokens = config.maxContextTokens ?? getDefaultContextBudget(config.provider);
    return buildSmartConversationHistory({
      messages: base.map((msg) => ({
        role: msg.role,
        content: msg.content,
        images: msg.images,
        toolName: msg.toolName,
        toolArgs: msg.toolArgs,
        toolResult: msg.toolResult,
        success: msg.success,
      })),
      includeImages,
      maxContextTokens,
      provider: config.provider,
    });
  };

  const getStreamCallbacks = (): AgentStreamCallbacks => ({
    createId,
    setMessages,
    setChatError,
    setCurrentTokens,
    setTokenBreakdown,
    setIsProcessing,
    setProcessingStartTime,
    setCurrentTitle,
    titleExtractedRef,
    currentTitleRef,
    lastPromptTokensRef,
    exploreToolsRef,
    explorePurposeRef,
    exploreMessageIdRef,
    disposedRef,
    pendingCompactTokensRef,
    abortControllerRef,
    pendingChangesRef,
    currentTitle,
  });

  const buildCommandContext = useCallback((sourceMessages: Message[]): CommandExecutionContext => ({
    messages: sourceMessages.map((message) => ({
      role: message.role,
      content: message.content,
      thinkingContent: message.thinkingContent,
      images: message.images,
      toolName: message.toolName,
      toolArgs: message.toolArgs,
      toolResult: message.toolResult,
      success: message.success,
    })),
    imagesSupported,
    currentTokens,
    tokenBreakdown: { ...tokenBreakdown },
    lastPromptTokens: lastPromptTokensRef.current,
    isProcessing,
  }), [imagesSupported, currentTokens, tokenBreakdown, isProcessing]);

  const handleResubmitUserMessage = (payload: { id: string; index: number; content: string; images: ImageAttachment[] }) => {
    debugLog(`[ui] input-resubmit requested id=${payload.id} index=${payload.index} chars=${payload.content.length} images=${payload.images.length} preview="${toLogPreview(payload.content, 800)}"`);
    if (isProcessing) return;
    const byId = messages.findIndex(m => m.id === payload.id);
    const targetIndex = byId >= 0 ? byId : payload.index;
    if (targetIndex < 0 || targetIndex >= messages.length) return;
    const target = messages[targetIndex];
    if (!target || target.role !== 'user') return;
    const baseMessages = messages.slice(0, targetIndex);
    const safeImages = imagesSupported ? payload.images : [];
    shouldAutoScroll.current = true;
    setScrollOffset(0);
    handleSubmit(payload.content, undefined, { baseMessages, images: safeImages });
  };

  const handleSubmit = async (value: string, meta?: InputSubmitMeta, options?: { baseMessages?: Message[]; images?: ImageAttachment[] }) => {
    if (isProcessing) return;

    setChatError(null);
    const hasPastedContent = Boolean(meta?.isPaste && meta.pastedContent && value.includes(meta.pastedContent));
    const imagesForMessage = options?.images ?? (imagesSupported ? pendingImages : []);
    const hasImages = imagesForMessage.length > 0;
    if (!value.trim() && !hasPastedContent && !hasImages) return;
    debugLog(`[ui] submit received chars=${value.length} trimmed=${value.trim().length} pasted=${hasPastedContent} images=${imagesForMessage.length} hasBaseMessages=${Boolean(options?.baseMessages)} preview="${toLogPreview(value, 800)}"`);

    const baseMessages = options?.baseMessages ?? messages;

    if (value.trim().startsWith('!')) {
      const shellCommand = value.trim().slice(1).trim();
      if (!shellCommand) return;

      debugLog(`[ui] input type=shell commandChars=${shellCommand.length} command="${toLogPreview(shellCommand, 2000)}"`);
      addInputToHistory(value.trim());

      const shellCommandDisplay = `!${shellCommand}`;
      const userMessageId = createId();
      const userMessageShell: Message = {
        id: userMessageId,
        role: "user",
        content: shellCommandDisplay,
        displayContent: shellCommandDisplay,
      };

      setMessages(() => [...baseMessages, userMessageShell]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const toolMessageId = createId();
      setMessages((prev: Message[]) => [...prev, {
        id: toolMessageId,
        role: "tool",
        content: `Running: ${shellCommand}`,
        toolName: "bash",
        toolArgs: { command: shellCommand },
        success: true,
        isRunning: true,
        runningStartTime: Date.now()
      }]);

      let shellResult: string;
      let shellSuccess: boolean;
      try {
        const result = await executeTool('bash', { command: shellCommand }, { skipApproval: true });
        shellResult = result.result ?? result.error ?? 'No output';
        shellSuccess = result.success;
        debugLog(`[ui] shell result success=${shellSuccess} resultChars=${shellResult.length} preview="${toLogPreview(shellResult, 1200)}"`);

        const { content: toolContent } = formatToolMessage(
          'bash',
          { command: shellCommand },
          shellResult,
          { maxLines: DEFAULT_MAX_TOOL_LINES }
        );

        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          const idx = newMessages.findIndex(m => m.id === toolMessageId);
          if (idx !== -1) {
            newMessages[idx] = {
              ...newMessages[idx]!,
              content: toolContent,
              toolResult: shellResult,
              success: shellSuccess,
              isRunning: false,
              runningStartTime: undefined
            };
          }
          return newMessages;
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        shellResult = `Error: ${errorMsg}`;
        shellSuccess = false;
        debugLog(`[ui] shell error message="${toLogPreview(errorMsg, 600)}"`);

        setMessages((prev: Message[]) => {
          const newMessages = [...prev];
          const idx = newMessages.findIndex(m => m.id === toolMessageId);
          if (idx !== -1) {
            newMessages[idx] = {
              ...newMessages[idx]!,
              content: shellResult,
              success: false,
              isRunning: false,
              runningStartTime: undefined
            };
          }
          return newMessages;
        });
      }

      const composedShellContent = `I ran this command: ${shellCommand}

Output:
${shellResult}

Analyze the output and continue. Do not run the same command again unless I explicitly ask.`;

      const userMessageForAgent: Message = {
        ...userMessageShell,
        content: composedShellContent,
      };

      setMessages((prev: Message[]) => {
        const newMessages = [...prev];
        const userIdx = newMessages.findIndex(m => m.id === userMessageId);
        if (userIdx !== -1) {
          newMessages[userIdx] = userMessageForAgent;
        }
        return newMessages;
      });

      setIsProcessing(true);
      setProcessingStartTime(Date.now());
      shouldAutoScroll.current = true;

      const convHistory = buildConversationHistory([...baseMessages, userMessageForAgent], imagesSupported);
      await runAgentStream({
        baseMessages,
        userMessage: userMessageForAgent,
        conversationHistory: convHistory,
        abortMessage: "Conversation interrupted — tell Mosaic what to do differently. Something went wrong? Hit `/feedback` to report the issue.",
        userStepContent: composedShellContent,
        autoCompact: true,
      }, getStreamCallbacks());

      return;
    }

    if (isCommand(value)) {
      debugLog(`[ui] input type=slash commandChars=${value.trim().length} command="${toLogPreview(value.trim(), 1200)}"`);
      const result = await executeCommand(value, buildCommandContext(baseMessages));
      if (result) {
        debugLog(`[ui] slash result success=${result.success} clear=${Boolean(result.shouldClearMessages)} compact=${Boolean(result.shouldCompactMessages)} addToHistory=${result.shouldAddToHistory !== false} showSelect=${Boolean(result.showSelectMenu)} contentPreview="${toLogPreview(result.content || '', 500)}"`);
        if (result.errorBanner) {
          setChatError(result.errorBanner);
        } else {
          setChatError(null);
        }
        if (result.showSelectMenu) {
          setSelectMenu(result.showSelectMenu);
          return;
        }

        if (result.shouldClearMessages === true && result.shouldCompactMessages !== true) {
          Agent.resetSessionState();
          currentTitleRef.current = null;
          titleExtractedRef.current = false;
          setCurrentTitle(null);
          setChatError(null);
          setTerminalTitle('⁘ Mosaic');
          setCurrentTokens(0);
          setTokenBreakdown({ prompt: 0, reasoning: 0, output: 0, tools: 0 });
          setPendingImages([]);
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
          const targetTokens = maxContextTokens ?? getDefaultContextBudget(config.provider);
          let nextTokens = currentTokens;
          setMessages(prev => {
            const usedTokens = estimateTotalTokens(prev, systemPrompt);
            const compacted = compactMessagesForUi(prev, systemPrompt, targetTokens, createId, true);
            if (!compacted.didCompact) return prev;
            const compactDisplay = buildCompactionDisplay('manual', usedTokens, targetTokens, compacted.estimatedTokens);
            const compactNotice: Message = {
              id: createId(),
              role: "slash",
              content: compactDisplay,
              success: true
            };
            nextTokens = compacted.estimatedTokens;
            return [compactNotice, ...compacted.messages];
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

          setMessages(() => [...baseMessages, userMessage]);
          setIsProcessing(true);
          setProcessingStartTime(Date.now());
          shouldAutoScroll.current = true;

          const convHistory = buildConversationHistory([...baseMessages, userMessage], imagesSupported);
          await runAgentStream({
            baseMessages,
            userMessage,
            conversationHistory: convHistory,
            abortMessage: "Conversation interrupted — tell Mosaic what to do differently. Something went wrong? Hit `/feedback` to report the issue.",
            userStepContent: result.content,
            autoCompact: false,
          }, getStreamCallbacks());

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

    const composedContent = value;
    debugLog(`[ui] input type=user chars=${composedContent.length} pasted=${hasPastedContent} images=${imagesForMessage.length} preview="${toLogPreview(composedContent, 2000)}"`);

    addInputToHistory(value.trim() || (hasPastedContent ? '[Pasted text]' : (hasImages ? '[Image]' : value)));

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: composedContent,
      images: imagesForMessage.length > 0 ? imagesForMessage : undefined,
    };

    if (!options?.images && imagesForMessage.length > 0) {
      setPendingImages([]);
    }

    setMessages((prev: Message[]) => [...(options?.baseMessages ?? prev), userMessage]);
    setIsProcessing(true);
    setProcessingStartTime(Date.now());
    shouldAutoScroll.current = true;

    const convHistory = buildConversationHistory([...baseMessages, userMessage], imagesSupported);
    await runAgentStream({
      baseMessages,
      userMessage,
      conversationHistory: convHistory,
      abortMessage: "Conversation interrupted — tell Mosaic what to do differently. Something went wrong? Hit `/feedback` to report the issue.",
      userStepContent: composedContent,
      userStepImages: imagesForMessage.length > 0 ? imagesForMessage : undefined,
      autoCompact: true,
    }, getStreamCallbacks());
  };

  useEffect(() => {
    if (initialMessage && !initialMessageProcessed.current && currentPage === "chat") {
      initialMessageProcessed.current = true;
      handleSubmit(initialMessage);
    }
  }, [initialMessage, currentPage, handleSubmit]);

    if (currentPage === "home") {
    const handleHomeSubmit = async (value: string, meta?: InputSubmitMeta) => {
      const hasPastedContent = Boolean(meta?.isPaste && meta.pastedContent);
      if (!value.trim() && !hasPastedContent) return;
      debugLog(`[ui] home-submit chars=${value.length} pasted=${hasPastedContent} isCommand=${isCommand(value)} preview="${toLogPreview(value, 800)}"`);

      if (isCommand(value)) {
        const result = await executeCommand(value, buildCommandContext(messages));
        if (result?.showSelectMenu) {
          debugLog(`[ui] home-submit slash-select-menu title="${toLogPreview(result.showSelectMenu.title, 120)}" options=${result.showSelectMenu.options.length}`);
          setCurrentPage("chat");
          setSelectMenu(result.showSelectMenu);
          return;
        }
      }

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

  const handleReviewRespond = (approved: boolean) => {
    respondReview(approved);
    setCurrentReviewChange(getCurrentReviewChange());
    setReviewProgress(getReviewProgress());
  };

  const handleReviewKeep = () => {
    handleReviewRespond(true);
  };

  const handleReviewReject = async () => {
    await handleRevertChange();
    handleReviewRespond(false);
  };

  const handleReviewAcceptAll = () => {
    acceptAllReview();
    setCurrentReviewChange(getCurrentReviewChange());
    setReviewProgress(getReviewProgress());
  };

  const handleRevertChange = async () => {
    if (currentReviewChange) {
      await revertChange(currentReviewChange);
    }
  };

  const reviewPanelElement = isReviewMode && currentReviewChange ? (
    <ReviewPanel
      change={currentReviewChange}
      progress={reviewProgress}
      onKeep={handleReviewKeep}
      onRevert={handleReviewReject}
      onAcceptAll={handleReviewAcceptAll}
    />
  ) : undefined;

  const modalWidth = Math.min(60, Math.floor(terminalWidth * 0.8));
  const modalHeight = Math.min(20, Math.floor(terminalHeight * 0.7));

  const selectMenuElement = selectMenu ? (
    <CommandSelectMenu
      title={selectMenu.title}
      options={selectMenu.options}
      modalWidth={modalWidth}
      modalHeight={modalHeight}
      shortcutsOpen={shortcutsOpen}
      onSelect={(value) => {
        const option = selectMenu.options.find(opt => opt.value === value);
        selectMenu.onSelect(value);
        setSelectMenu(null);

        if (option) {
          const confirmationMessage: Message = {
            id: createId(),
            role: "slash",
            content: `${option.name} selected`,
          };
          setMessages(prev => [...prev, confirmationMessage]);
        }
      }}
      onClose={() => setSelectMenu(null)}
    />
  ) : undefined;

  return (
    <ChatPage
      messages={messages}
      isProcessing={isProcessing && !isReviewMode}
      processingStartTime={isReviewMode ? null : processingStartTime}
      currentTokens={currentTokens}
      tokenBreakdown={tokenBreakdown}
      scrollOffset={scrollOffset}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
      pasteRequestId={pasteRequestId}
      shortcutsOpen={shortcutsOpen}
      onModalOpenChange={handleChatModalOpenChange}
      onSubmit={handleSubmit}
      onCopyMessage={onCopy}
      onResubmitUserMessage={handleResubmitUserMessage}
      pendingImages={pendingImages}
      chatError={chatError}
      reviewPanel={reviewPanelElement}
      selectMenu={selectMenuElement}
    />
  );
}
