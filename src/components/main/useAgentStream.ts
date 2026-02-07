import { Agent } from "../../agent";
import { saveConversation, type ConversationHistory, type ConversationStep } from "../../utils/history";
import { readConfig } from "../../utils/config";
import { DEFAULT_MAX_TOOL_LINES, formatToolMessage, formatErrorMessage, parseToolHeader, normalizeToolCall } from "../../utils/toolFormatting";
import { setExploreAbortController } from "../../utils/exploreBridge";
import { BLEND_WORDS, type Message, type TokenBreakdown } from "./types";
import { extractTitle, extractTitleFromToolResult, setTerminalTitle } from "./titleUtils";
import { compactMessagesForUi, estimateTotalTokens, shouldAutoCompact } from "./compaction";
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from "../../agent/prompts/systemPrompt";
import { getDefaultContextBudget } from "../../utils/tokenEstimator";
import { getModelsDevContextLimit } from "../../utils/models";
import { hasPendingChanges, clearPendingChanges, startReview } from "../../utils/pendingChangesBridge";
import type { ImageAttachment } from "../../utils/images";
import type { UserContent } from "ai";

export interface AgentStreamCallbacks {
  createId: () => string;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setCurrentTokens: (updater: number | ((prev: number) => number)) => void;
  setTokenBreakdown: (updater: TokenBreakdown | ((prev: TokenBreakdown) => TokenBreakdown)) => void;
  setIsProcessing: (value: boolean) => void;
  setProcessingStartTime: (value: number | null) => void;
  setCurrentTitle: (title: string) => void;
  titleExtractedRef: React.MutableRefObject<boolean>;
  currentTitleRef: React.MutableRefObject<string | null>;
  lastPromptTokensRef: React.MutableRefObject<number>;
  exploreToolsRef: React.MutableRefObject<Array<{ tool: string; info: string; success: boolean }>>;
  explorePurposeRef: React.MutableRefObject<string>;
  exploreMessageIdRef: React.MutableRefObject<string | null>;
  disposedRef: React.MutableRefObject<boolean>;
  pendingCompactTokensRef: React.MutableRefObject<number | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  pendingChangesRef: React.MutableRefObject<unknown[]>;
  currentTitle: string | null;
}

export interface AgentStreamParams {
  baseMessages: Message[];
  userMessage: Message;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string | UserContent }>;
  abortMessage: string;
  userStepContent: string;
  userStepImages?: ImageAttachment[];
  autoCompact: boolean;
}

export async function runAgentStream(
  params: AgentStreamParams,
  callbacks: AgentStreamCallbacks
) {
  const {
    baseMessages,
    userMessage,
    conversationHistory,
    abortMessage,
    userStepContent,
    userStepImages,
    autoCompact,
  } = params;

  const {
    createId,
    setMessages,
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
  } = callbacks;

  const localStartTime = Date.now();
  setCurrentTokens(0);
  setTokenBreakdown({ prompt: 0, reasoning: 0, output: 0, tools: 0 });
  lastPromptTokensRef.current = 0;
  let maxTokensSeen = 0;

  const conversationId = createId();
  const conversationSteps: ConversationStep[] = [];
  let totalTokens = { prompt: 0, completion: 0, total: 0 };
  let stepCount = 0;
  let totalChars = 0;
  let reasoningChars = 0;
  let outputChars = 0;
  let toolChars = 0;
  for (const m of baseMessages) {
    if (m.role === 'assistant') {
      totalChars += m.content.length;
      if (m.thinkingContent) totalChars += m.thinkingContent.length;
    } else if (m.role === 'tool') {
      totalChars += m.content.length;
    }
  }

  const estimateTokens = () => Math.ceil(totalChars / 4);
  const setCurrentTokensMonotonic = (updater: number | ((prev: number) => number)) => {
    setCurrentTokens((prev) => {
      const prevValue = typeof prev === "number" ? prev : 0;
      const candidate = typeof updater === "function" ? updater(prevValue) : updater;
      const safeCandidate = Number.isFinite(candidate) ? candidate : prevValue;
      const next = Math.max(prevValue, safeCandidate, maxTokensSeen);
      maxTokensSeen = next;
      return next;
    });
  };
  const allocateTokensByWeight = (total: number, weights: number[]): number[] => {
    if (total <= 0) return weights.map(() => 0);
    const cleaned = weights.map((w) => Math.max(0, w));
    const sum = cleaned.reduce((acc, w) => acc + w, 0);
    if (sum <= 0) {
      const base = Math.floor(total / cleaned.length);
      const remainder = total - (base * cleaned.length);
      return cleaned.map((_, i) => base + (i < remainder ? 1 : 0));
    }

    const raw = cleaned.map((w) => (w / sum) * total);
    const floored = raw.map((v) => Math.floor(v));
    let remaining = total - floored.reduce((acc, v) => acc + v, 0);
    const byFraction = raw
      .map((v, i) => ({ i, fraction: v - floored[i]! }))
      .sort((a, b) => b.fraction - a.fraction);

    for (let i = 0; i < byFraction.length && remaining > 0; i++) {
      floored[byFraction[i]!.i] = floored[byFraction[i]!.i]! + 1;
      remaining--;
    }

    return floored;
  };
  const updateBreakdown = () => {
    setTokenBreakdown({
      prompt: 0,
      reasoning: Math.ceil(reasoningChars / 4),
      output: Math.ceil(outputChars / 4),
      tools: Math.ceil(toolChars / 4),
    });
  };
  setCurrentTokensMonotonic(estimateTokens());
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
    if (disposedRef.current) return;
    setMessages((prev: Message[]) => {
      const newMessages = [...prev];
      newMessages.push({
        id: createId(),
        role: "tool",
        toolName: "abort",
        success: false,
        content: abortMessage
      });
      return newMessages;
    });
  };

  conversationSteps.push({
    type: 'user',
    content: userStepContent,
    timestamp: Date.now(),
    images: userStepImages,
  });

  let responseDuration: number | null = null;
  let responseBlendWord: string | undefined = undefined;

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
        reasoningChars += event.content.length;
        setCurrentTokensMonotonic(estimateTokens());
        updateBreakdown();

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
        outputChars += event.content.length;
        setCurrentTokensMonotonic(estimateTokens());
        updateBreakdown();

        const { title, cleanContent, isPending, noTitle, isTitlePseudoCall } = extractTitle(assistantChunk, titleExtractedRef.current);

        if (title) {
          titleExtractedRef.current = true;
          currentTitleRef.current = title;
          setCurrentTitle(title);
          setTerminalTitle(title);
          if (isTitlePseudoCall) {
            const toolArgs = { title } as Record<string, unknown>;
            const toolResult = { title } as Record<string, unknown>;
            const { content: toolContent, success } = formatToolMessage('title', toolArgs, toolResult, { maxLines: DEFAULT_MAX_TOOL_LINES });
            conversationSteps.push({
              type: 'tool',
              content: toolContent,
              toolName: 'title',
              toolArgs,
              toolResult,
              timestamp: Date.now(),
            });
            setMessages((prev: Message[]) => ([
              ...prev,
              {
                id: createId(),
                role: 'tool',
                content: toolContent,
                toolName: 'title',
                toolArgs,
                toolResult,
                success,
                timestamp: Date.now(),
              },
            ]));
          }
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
        const argsLen = JSON.stringify(event.args).length;
        totalChars += argsLen;
        toolChars += argsLen;
        setCurrentTokensMonotonic(estimateTokens());
        updateBreakdown();

        const normalized = normalizeToolCall(event.toolName, event.args ?? {});
        const toolName = normalized.toolName;
        const toolArgs = normalized.args;
        const isExploreTool = toolName === 'explore';
        const isMcpTool = toolName.startsWith('mcp__');
        let runningMessageId: string | undefined;

        if (isExploreTool) {
          setExploreAbortController(abortController);
          exploreToolsRef.current = [];
          const purpose = (toolArgs.purpose as string) || 'exploring...';
          explorePurposeRef.current = purpose;
        }

        if (isExploreTool || isMcpTool) {
          runningMessageId = createId();
          if (isExploreTool) {
            exploreMessageIdRef.current = runningMessageId;
          }
          const { name: toolDisplayName, info: toolInfo } = parseToolHeader(toolName, toolArgs);
          const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;

          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            newMessages.push({
              id: runningMessageId!,
              role: "tool",
              content: runningContent,
              toolName,
              toolArgs,
              success: true,
              isRunning: true,
              runningStartTime: Date.now()
            });
            return newMessages;
          });
        }

        pendingToolCalls.set(event.toolCallId, {
          toolName,
          args: toolArgs,
          messageId: runningMessageId
        });

      } else if (event.type === 'tool-result') {
        const pending = pendingToolCalls.get(event.toolCallId);
        const toolName = pending?.toolName ?? event.toolName;
        const toolArgs = pending?.args ?? {};
        const runningMessageId = pending?.messageId;
        pendingToolCalls.delete(event.toolCallId);

        if (toolName === 'title') {
          const nextTitle = extractTitleFromToolResult(event.result);
          if (nextTitle) {
            currentTitleRef.current = nextTitle;
            setCurrentTitle(nextTitle);
            setTerminalTitle(nextTitle);
          }
        }

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
        toolChars += toolResultStr.length;
        setCurrentTokensMonotonic(estimateTokens());
        updateBreakdown();

        if (assistantChunk.trim() || thinkingChunk.trim()) {
          conversationSteps.push({
            type: 'assistant',
            content: assistantChunk,
            thinkingContent: thinkingChunk || undefined,
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
          } else if (toolName === 'bash' || toolName === 'explore' || toolName.startsWith('mcp__')) {
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
        if (assistantChunk.trim() || thinkingChunk.trim()) {
          conversationSteps.push({
            type: 'assistant',
            content: assistantChunk,
            thinkingContent: thinkingChunk || undefined,
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
          const promptTokens = Math.max(0, event.usage.promptTokens ?? 0);
          const completionTokens = Math.max(
            0,
            (event.usage.completionTokens ?? 0) || (event.usage.totalTokens - promptTokens)
          );
          const allocatedTokens = allocateTokensByWeight(
            completionTokens,
            [reasoningChars, outputChars, toolChars]
          );
          const reasoningTokens = allocatedTokens[0] ?? 0;
          const outputTokens = allocatedTokens[1] ?? 0;
          const toolTokens = allocatedTokens[2] ?? 0;

          totalTokens = {
            prompt: event.usage.promptTokens,
            completion: event.usage.completionTokens,
            total: event.usage.totalTokens
          };
          lastPromptTokensRef.current = event.usage.promptTokens;
          setCurrentTokensMonotonic(event.usage.totalTokens);
          setTokenBreakdown({
            prompt: promptTokens,
            reasoning: reasoningTokens,
            output: outputTokens,
            tools: toolTokens
          });
        }
      }
    }

    if (abortController.signal.aborted) {
      notifyAbort();
      return;
    }

    if (!streamHadError && (assistantChunk.trim() || thinkingChunk.trim())) {
      conversationSteps.push({
        type: 'assistant',
        content: assistantChunk,
        thinkingContent: thinkingChunk || undefined,
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

    if (autoCompact) {
      const resolvedMax = await resolveMaxContextTokens();
      const maxContextTokens = resolvedMax ?? getDefaultContextBudget(config.provider);
      if (!abortController.signal.aborted && !disposedRef.current) {
        const realPromptTokens = lastPromptTokensRef.current;
        const systemPrompt = buildSystemPrompt();
        pendingCompactTokensRef.current = null;
        setMessages(prev => {
          const usedTokens = realPromptTokens > 0
            ? realPromptTokens
            : estimateTotalTokens(prev, systemPrompt);
          if (!shouldAutoCompact(usedTokens, maxContextTokens)) return prev;
          const compacted = compactMessagesForUi(prev, systemPrompt, maxContextTokens, createId, true);
          pendingCompactTokensRef.current = compacted.estimatedTokens;
          return compacted.messages;
        });
        setCurrentTokensMonotonic(prev => pendingCompactTokensRef.current !== null ? pendingCompactTokensRef.current : prev);
      }
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
    if (!disposedRef.current) {
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

      if (hasPendingChanges()) {
        startReview().then((results) => {
          let revertedCount = 0;
          let keptCount = 0;

          for (let i = 0; i < results.length; i++) {
            if (results[i]) {
              keptCount++;
            } else {
              revertedCount++;
            }
          }

          if (revertedCount > 0 || keptCount > 0) {
            setMessages((prev: Message[]) => [...prev, {
              id: createId(),
              role: "tool",
              toolName: "review",
              content: `Review complete: ${keptCount} kept, ${revertedCount} reverted`,
              success: true,
            }]);
          }

          clearPendingChanges();
          setIsProcessing(false);
          setProcessingStartTime(null);
        });
      } else {
        setIsProcessing(false);
        setProcessingStartTime(null);
      }
    }
  }
}
