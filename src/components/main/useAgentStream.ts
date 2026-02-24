import { Agent, type AgentMessage } from "../../agent";
import { saveConversation, type ConversationHistory, type ConversationStep } from "../../utils/history";
import { readConfig } from "../../utils/config";
import { DEFAULT_MAX_TOOL_LINES, formatToolMessage, formatErrorMessage, parseToolHeader, normalizeToolCall } from "../../utils/toolFormatting";
import { setExploreAbortController } from "../../utils/exploreBridge";
import { BLEND_WORDS, type Message, type TokenBreakdown } from "./types";
import { extractTitle, extractTitleFromToolResult, setTerminalTitle } from "./titleUtils";
import { buildCompactionDisplay, compactMessagesForUi, estimateTotalTokens, shouldAutoCompact } from "./compaction";
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from "../../agent/prompts/systemPrompt";
import { getDefaultContextBudget } from "../../utils/tokenEstimator";
import { getModelsDevContextLimit } from "../../utils/models";
import { sanitizeAccumulatedText } from "../../agent/provider/streamSanitizer";
import { debugLog } from "../../utils/debug";
import { hasPendingChanges, cancelReview, isInReviewMode, startReview } from "../../utils/pendingChangesBridge";
import type { ImageAttachment } from "../../utils/images";

const MAX_CONTINUATIONS = 3;
const MAX_CONTINUATION_TOOL_MESSAGES = 8;
const MAX_CONTINUATION_TOOL_RESULT_CHARS = 900;
const MAX_CONTINUATION_LEDGER_ENTRIES = 6;
const CONTINUATION_LEDGER_PREFIX = 'TOOL LEDGER (continuation context):';
const CONTINUATION_TOOL_PRIORITY = ['plan', 'explore', 'grep', 'glob', 'read', 'write', 'edit'];
const CONTINUATION_TOOL_SKIP = new Set(['title', 'question', 'abort', 'review']);
const CONTINUATION_LEDGER_ONLY_TOOLS = new Set(['grep', 'glob', 'fetch', 'list']);

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateForContinuation(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function toLogPreview(value: string, maxChars: number): string {
  const normalized = value
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/"/g, "'");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function getToolNameFromHistoryMessage(message: AgentMessage): string | null {
  if (message.role !== 'tool') return null;
  const content = message.content as any;
  const part = Array.isArray(content) ? content[0] : undefined;
  const rawName = part?.toolName ?? part?.tool_name;
  if (typeof rawName !== 'string' || !rawName.trim()) return null;
  return rawName;
}

function buildContinuationLedgerLine(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  success: boolean
): string {
  const status = success ? 'OK' : 'FAILED';
  const argsText = truncateForContinuation(stringifyUnknown(toolArgs).replace(/\s+/g, ' ').trim(), 80);
  const resultText = truncateForContinuation(stringifyUnknown(toolResult).replace(/\s+/g, ' ').trim(), 140);
  return `- [${status}] ${toolName}(${argsText}) => ${resultText}`;
}

function upsertContinuationLedgerMessage(history: AgentMessage[], ledgerEntries: string[]): void {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === 'assistant' && typeof msg.content === 'string' && msg.content.startsWith(CONTINUATION_LEDGER_PREFIX)) {
      history.splice(i, 1);
    }
  }
  if (ledgerEntries.length === 0) return;
  history.push({
    role: 'assistant',
    content: `${CONTINUATION_LEDGER_PREFIX}\n${ledgerEntries.join('\n')}`,
  });
}

function pruneContinuationToolMessages(history: AgentMessage[]): void {
  const toolIndexes: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i]?.role === 'tool') {
      toolIndexes.push(i);
    }
  }

  if (toolIndexes.length <= MAX_CONTINUATION_TOOL_MESSAGES) return;

  const keep = new Set<number>();
  for (const toolName of CONTINUATION_TOOL_PRIORITY) {
    for (let i = toolIndexes.length - 1; i >= 0; i--) {
      const idx = toolIndexes[i]!;
      if (getToolNameFromHistoryMessage(history[idx]!) === toolName) {
        keep.add(idx);
        break;
      }
    }
  }

  for (let i = toolIndexes.length - 1; i >= 0 && keep.size < MAX_CONTINUATION_TOOL_MESSAGES; i--) {
    keep.add(toolIndexes[i]!);
  }

  const nextHistory: AgentMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]!;
    if (msg.role === 'tool' && !keep.has(i)) continue;
    nextHistory.push(msg);
  }

  history.splice(0, history.length, ...nextHistory);
  const removed = toolIndexes.length - keep.size;
  if (removed > 0) {
    debugLog(`[context] continuation tool-prune removed=${removed} kept=${keep.size} max=${MAX_CONTINUATION_TOOL_MESSAGES}`);
  }
}

function summarizeContinuationHistory(history: AgentMessage[]): string {
  let user = 0;
  let assistant = 0;
  let tool = 0;
  let other = 0;
  for (const entry of history) {
    if (entry.role === 'user') user++;
    else if (entry.role === 'assistant') assistant++;
    else if (entry.role === 'tool') tool++;
    else other++;
  }
  return `len=${history.length} roles={user:${user},assistant:${assistant},tool:${tool},other:${other}}`;
}

function pushContinuationToolContext(
  history: AgentMessage[],
  ledgerEntries: string[],
  toolCallId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  success: boolean
): void {
  if (CONTINUATION_TOOL_SKIP.has(toolName)) return;

  const rawResult = stringifyUnknown(toolResult);
  const isLargePayload = rawResult.length > MAX_CONTINUATION_TOOL_RESULT_CHARS;
  const compactResult = truncateForContinuation(rawResult, MAX_CONTINUATION_TOOL_RESULT_CHARS);
  const continuationResult = isLargePayload
    ? `${compactResult} [truncated for continuation context]`
    : toolResult;

  const normalizedToolCallId = toolCallId && toolCallId.trim()
    ? toolCallId
    : `continuation-${toolName}-${Date.now()}`;

  const ledgerOnly = CONTINUATION_LEDGER_ONLY_TOOLS.has(toolName) || toolName.startsWith('mcp__');
  if (!ledgerOnly) {
    history.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: normalizedToolCallId,
        toolName,
        result: continuationResult,
      }] as any,
    });
    pruneContinuationToolMessages(history);
  }

  ledgerEntries.push(buildContinuationLedgerLine(toolName, toolArgs, toolResult, success));
  if (ledgerEntries.length > MAX_CONTINUATION_LEDGER_ENTRIES) {
    ledgerEntries.splice(0, ledgerEntries.length - MAX_CONTINUATION_LEDGER_ENTRIES);
  }
  upsertContinuationLedgerMessage(history, ledgerEntries);
  debugLog(`[context] continuation tool-ledger updated tool=${toolName} rawChars=${rawResult.length} ledgerEntries=${ledgerEntries.length} ledgerOnly=${ledgerOnly}`);
}

function extractPlanFromMessages(messages: Message[]): { steps: Array<{ step: string; status: string }> } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'tool' || m.toolName !== 'plan') continue;
    const result = m.toolResult;
    if (result && typeof result === 'object' && Array.isArray((result as any).plan)) {
      const plan = (result as any).plan;
      const steps = plan
        .map((s: any) => ({
          step: typeof s.step === 'string' ? s.step : '',
          status: typeof s.status === 'string' ? s.status : 'pending',
        }))
        .filter((s: any) => s.step.trim());
      if (steps.length > 0) return { steps };
    }
  }
  return null;
}

function hasPendingPlanSteps(messages: Message[]): boolean {
  const plan = extractPlanFromMessages(messages);
  if (!plan) return false;
  return plan.steps.some(s => s.status !== 'completed');
}

function extractPlanFromSteps(steps: ConversationStep[]): { steps: Array<{ step: string; status: string }> } | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type !== 'tool' || s.toolName !== 'plan') continue;
    const result = s.toolResult;
    if (result && typeof result === 'object' && Array.isArray((result as any).plan)) {
      const plan = (result as any).plan;
      const parsed = plan
        .map((p: any) => ({ step: typeof p.step === 'string' ? p.step : '', status: typeof p.status === 'string' ? p.status : 'pending' }))
        .filter((p: any) => p.step.trim());
      if (parsed.length > 0) return { steps: parsed };
    }
  }
  return null;
}

function hasPendingStepsInConversation(steps: ConversationStep[]): boolean {
  const plan = extractPlanFromSteps(steps);
  if (!plan) return false;
  return plan.steps.some(s => s.status !== 'completed');
}

function buildContinuationPromptFromSteps(steps: ConversationStep[]): string {
  const plan = extractPlanFromSteps(steps);
  if (!plan) return '';
  const pending = plan.steps.filter(s => s.status !== 'completed');
  const completed = plan.steps.filter(s => s.status === 'completed');
  const lines = pending.map(s => {
    const marker = s.status === 'in_progress' ? '[IN PROGRESS]' : '[PENDING]';
    return `${marker} ${s.step}`;
  });
  return `You stopped before completing the task. ${completed.length}/${plan.steps.length} steps done.\n\nRemaining steps:\n${lines.join('\n')}\n\nContinue working. Do NOT re-explain what was already done. Pick up from the current in-progress or next pending step and keep going until everything is completed.`;
}

function buildContinuationPrompt(messages: Message[]): string {
  const plan = extractPlanFromMessages(messages);
  if (!plan) return '';
  const pending = plan.steps.filter(s => s.status !== 'completed');
  const completed = plan.steps.filter(s => s.status === 'completed');
  const lines = pending.map(s => {
    const marker = s.status === 'in_progress' ? '[IN PROGRESS]' : '[PENDING]';
    return `${marker} ${s.step}`;
  });
  return `You stopped before completing the task. ${completed.length}/${plan.steps.length} steps done.\n\nRemaining steps:\n${lines.join('\n')}\n\nContinue working. Do NOT re-explain what was already done. Pick up from the current in-progress or next pending step and keep going until everything is completed.`;
}

export interface AgentStreamCallbacks {
  createId: () => string;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setChatError: (value: string | null) => void;
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
  conversationHistory: AgentMessage[];
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
  } = callbacks;

  const localStartTime = Date.now();
  setCurrentTokens(0);
  setTokenBreakdown({ prompt: 0, reasoning: 0, output: 0, tools: 0 });
  setChatError(null);
  lastPromptTokensRef.current = 0;
  let maxTokensSeen = 0;

  const conversationId = createId();
  debugLog(`[agent] stream start conversationId=${conversationId} baseMessages=${baseMessages.length} historyLen=${conversationHistory.length} autoCompact=${autoCompact} userChars=${userStepContent.length} userImages=${userStepImages?.length ?? 0} preview="${toLogPreview(userStepContent, 1600)}"`);
  const conversationSteps: ConversationStep[] = [];
  const continuationHistory: AgentMessage[] = conversationHistory.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));
  const continuationToolLedger: string[] = [];
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
  let totalReviewedKept = 0;
  let totalReviewedReverted = 0;
  const notifyAbort = () => {
    if (abortNotified) return;
    abortNotified = true;
    debugLog(`[agent] stream abort conversationId=${conversationId}`);
    if (disposedRef.current) return;
    setChatError(abortMessage);
  };

  const processPendingReviews = async () => {
    if (!hasPendingChanges() || isInReviewMode()) {
      return;
    }

    const cancelOnAbort = () => {
      cancelReview();
    };
    abortController.signal.addEventListener('abort', cancelOnAbort, { once: true });

    try {
      const results = await startReview();
      if (!results.length) {
        return;
      }

      let keptCount = 0;
      let revertedCount = 0;
      for (let i = 0; i < results.length; i++) {
        if (results[i]) {
          keptCount++;
        } else {
          revertedCount++;
        }
      }

      totalReviewedKept += keptCount;
      totalReviewedReverted += revertedCount;

      if (keptCount > 0 || revertedCount > 0) {
        const reviewSuccess = revertedCount === 0;
        setMessages((prev: Message[]) => [...prev, {
          id: createId(),
          role: "tool",
          toolName: "review",
          content: reviewSuccess
            ? `Review complete: ${keptCount} kept, ${revertedCount} denied`
            : `Review rejected: ${keptCount} kept, ${revertedCount} denied`,
          success: reviewSuccess,
        }]);
      }
    } finally {
      abortController.signal.removeEventListener('abort', cancelOnAbort);
    }
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
      const providerError = providerStatus.error || 'Provider is not ready. Check your local runtime and credentials.';
      const errorContent = formatErrorMessage('API', providerError, {
        source: 'provider',
        provider: config.provider,
        model: config.model,
      });
      setChatError(errorContent);
      setIsProcessing(false);
      return;
    }

    const agent = new Agent();
    let assistantChunk = '';
    let thinkingChunk = '';
    const pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown>; messageId?: string }>();
    let assistantMessageId: string | null = null;
    let streamHadError = false;
    let lastFinishReason = 'stop';
    titleExtractedRef.current = false;

    for await (const event of agent.streamMessages(conversationHistory, { abortSignal: abortController.signal, alreadyCompacted: true })) {
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

        const displayContent = sanitizeAccumulatedText(cleanContent);
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
          const cleanedAssistant = sanitizeAccumulatedText(assistantChunk);
          conversationSteps.push({
            type: 'assistant',
            content: cleanedAssistant,
            thinkingContent: thinkingChunk || undefined,
            timestamp: Date.now()
          });
          if (cleanedAssistant) {
            continuationHistory.push({ role: 'assistant', content: cleanedAssistant });
          }
        }

        conversationSteps.push({
          type: 'tool',
          content: toolContent,
          toolName,
          toolArgs,
          toolResult: event.result,
          timestamp: Date.now()
        });
        pushContinuationToolContext(
          continuationHistory,
          continuationToolLedger,
          event.toolCallId,
          toolName,
          toolArgs,
          event.result,
          success
        );

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

        await processPendingReviews();

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
            content: sanitizeAccumulatedText(assistantChunk),
            thinkingContent: thinkingChunk || undefined,
            timestamp: Date.now()
          });
        }

        const errorContent = formatErrorMessage('API', event.error, {
          source: 'provider',
          provider: config.provider,
          model: config.model,
        });
        conversationSteps.push({
          type: 'assistant',
          content: errorContent,
          timestamp: Date.now()
        });
        setChatError(errorContent);

        assistantChunk = '';
        thinkingChunk = '';
        assistantMessageId = null;
        streamHadError = true;
        break;
      } else if (event.type === 'finish') {
        lastFinishReason = event.finishReason || 'stop';
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
      const cleanedAssistant = sanitizeAccumulatedText(assistantChunk);
      conversationSteps.push({
        type: 'assistant',
        content: cleanedAssistant,
        thinkingContent: thinkingChunk || undefined,
        timestamp: Date.now()
      });
      if (cleanedAssistant) {
        continuationHistory.push({ role: 'assistant', content: cleanedAssistant });
      }
    }

    const hasForcedSkillInvocation = /FORCED SKILL INVOCATION/i.test(userStepContent);
    let continuationCount = 0;
    let lastActionSignature: string | null = null;

    const countPendingSteps = (): number => {
      const plan = extractPlanFromSteps(conversationSteps);
      return plan ? plan.steps.filter(s => s.status !== 'completed').length : 0;
    };

    const needsContinuation = (): boolean => {
      if (lastFinishReason === 'length') return true;
      if (hasPendingStepsInConversation(conversationSteps)) return true;
      if (hasForcedSkillInvocation && lastFinishReason === 'stop') {
        const hasToolStep = conversationSteps.some((step) => step.type === 'tool');
        if (!hasToolStep) return true;
      }
      return false;
    };

    const computeActionSignature = (): string => {
      const recentSteps = conversationSteps.slice(-5);
      return recentSteps
        .filter(s => s.type === 'tool')
        .map(s => `${s.toolName}:${JSON.stringify(s.toolArgs)}`)
        .join('|');
    };

    const planCheck = extractPlanFromSteps(conversationSteps);
    const pendingSteps = planCheck ? planCheck.steps.filter(s => s.status !== 'completed') : [];
    debugLog(`[continuation] check: lastFinishReason=${lastFinishReason} streamHadError=${streamHadError} planFound=${!!planCheck} pendingSteps=${pendingSteps.length} conversationSteps=${conversationSteps.length}`);
    debugLog(`[context] continuation history ${summarizeContinuationHistory(continuationHistory)} toolLedgerEntries=${continuationToolLedger.length}`);
    if (planCheck) {
      debugLog(`[continuation] plan steps: ${planCheck.steps.map(s => `[${s.status}] ${s.step.slice(0, 40)}`).join(' | ')}`);
    }

    while (
      !streamHadError &&
      !abortController.signal.aborted &&
      !disposedRef.current &&
      continuationCount < MAX_CONTINUATIONS &&
      needsContinuation()
    ) {
      continuationCount++;
      const isLengthTruncation = lastFinishReason === 'length';
      const isForcedSkillStall = hasForcedSkillInvocation && conversationSteps.every((step) => step.type !== 'tool');
      const continuationPrompt = isLengthTruncation
        ? 'Your previous response was cut off due to length limits. Continue exactly where you left off.'
        : isForcedSkillStall
          ? 'You were given a FORCED SKILL INVOCATION. Execute the requested workflow now. Start by using plan for concrete steps, then run the required tools. Do not stop before completion unless blocked by an explicit error.'
        : buildContinuationPromptFromSteps(conversationSteps);
      if (!continuationPrompt) break;

      const pendingBefore = countPendingSteps();
      let continuationToolCalls = 0;

      const continuationReason = isLengthTruncation
        ? 'length_truncation'
        : isForcedSkillStall ? 'forced_skill_no_progress' : 'pending_plan_steps';
      debugLog(`[continuation] auto-continue #${continuationCount} - reason=${continuationReason} pendingBefore=${pendingBefore}`);
      debugLog(`[context] continuation before-prompt ${summarizeContinuationHistory(continuationHistory)} toolLedgerEntries=${continuationToolLedger.length}`);

      conversationSteps.push({
        type: 'user',
        content: continuationPrompt,
        timestamp: Date.now(),
      });
      continuationHistory.push({ role: 'user', content: continuationPrompt });
      if (continuationHistory.length === 0) {
        debugLog('[continuation] skipped auto-continue because history is empty');
        break;
      }

      const continuationAgent = new Agent();
      assistantChunk = '';
      thinkingChunk = '';
      assistantMessageId = null;
      lastFinishReason = 'stop';
      pendingToolCalls.clear();

      for await (const event of continuationAgent.streamMessages(continuationHistory, { abortSignal: abortController.signal, alreadyCompacted: true })) {
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
              newMessages[messageIndex] = { ...newMessages[messageIndex]!, thinkingContent: thinkingChunk };
            }
            return newMessages;
          });
        } else if (event.type === 'text-delta') {
          assistantChunk += event.content;
          totalChars += event.content.length;
          outputChars += event.content.length;
          setCurrentTokensMonotonic(estimateTokens());
          updateBreakdown();

          const { cleanContent, isPending } = extractTitle(assistantChunk, true);
          if (isPending) continue;

          if (assistantMessageId === null) {
            assistantMessageId = createId();
          }

          const displayContent = sanitizeAccumulatedText(cleanContent);
          const currentMessageId = assistantMessageId;
          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            const messageIndex = newMessages.findIndex(m => m.id === currentMessageId);
            if (messageIndex === -1) {
              newMessages.push({ id: currentMessageId, role: "assistant", content: displayContent, thinkingContent: thinkingChunk });
            } else {
              newMessages[messageIndex] = { ...newMessages[messageIndex]!, content: displayContent, thinkingContent: thinkingChunk };
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
            explorePurposeRef.current = (toolArgs.purpose as string) || 'exploring...';
          }

          if (isExploreTool || isMcpTool) {
            runningMessageId = createId();
            if (isExploreTool) exploreMessageIdRef.current = runningMessageId;
            const { name: toolDisplayName, info: toolInfo } = parseToolHeader(toolName, toolArgs);
            const runningContent = toolInfo ? `${toolDisplayName} (${toolInfo})` : toolDisplayName;
            setMessages((prev: Message[]) => [...prev, {
              id: runningMessageId!,
              role: "tool",
              content: runningContent,
              toolName,
              toolArgs,
              success: true,
              isRunning: true,
              runningStartTime: Date.now()
            }]);
          }

          pendingToolCalls.set(event.toolCallId, { toolName, args: toolArgs, messageId: runningMessageId });
          continuationToolCalls++;
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

          const { content: toolContent, success } = formatToolMessage(toolName, toolArgs, event.result, { maxLines: DEFAULT_MAX_TOOL_LINES });
          const toolResultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
          totalChars += toolResultStr.length;
          toolChars += toolResultStr.length;
          setCurrentTokensMonotonic(estimateTokens());
          updateBreakdown();

          if (assistantChunk.trim() || thinkingChunk.trim()) {
            const cleanedAssistant = sanitizeAccumulatedText(assistantChunk);
            conversationSteps.push({
              type: 'assistant',
              content: cleanedAssistant,
              thinkingContent: thinkingChunk || undefined,
              timestamp: Date.now()
            });
            if (cleanedAssistant) {
              continuationHistory.push({ role: 'assistant', content: cleanedAssistant });
            }
          }

          conversationSteps.push({
            type: 'tool',
            content: toolContent,
            toolName,
            toolArgs,
            toolResult: event.result,
            timestamp: Date.now()
          });
          pushContinuationToolContext(
            continuationHistory,
            continuationToolLedger,
            event.toolCallId,
            toolName,
            toolArgs,
            event.result,
            success
          );

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
                toolArgs,
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
              toolArgs,
              toolResult: event.result,
              success
            });
            return newMessages;
          });

          await processPendingReviews();

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
              content: sanitizeAccumulatedText(assistantChunk),
              thinkingContent: thinkingChunk || undefined,
              timestamp: Date.now()
            });
          }
          const errorContent = formatErrorMessage('API', event.error, {
            source: 'provider',
            provider: config.provider,
            model: config.model,
          });
          conversationSteps.push({ type: 'assistant', content: errorContent, timestamp: Date.now() });
          setChatError(errorContent);
          assistantChunk = '';
          thinkingChunk = '';
          assistantMessageId = null;
          streamHadError = true;
          break;
        } else if (event.type === 'finish') {
          lastFinishReason = event.finishReason || 'stop';
          if (event.usage && event.usage.totalTokens > 0) {
            const promptTokens = Math.max(0, event.usage.promptTokens ?? 0);
            const completionTokens = Math.max(0, (event.usage.completionTokens ?? 0) || (event.usage.totalTokens - promptTokens));
            const allocatedTokens = allocateTokensByWeight(completionTokens, [reasoningChars, outputChars, toolChars]);
            totalTokens = { prompt: event.usage.promptTokens, completion: event.usage.completionTokens, total: event.usage.totalTokens };
            lastPromptTokensRef.current = event.usage.promptTokens;
            setCurrentTokensMonotonic(event.usage.totalTokens);
            setTokenBreakdown({
              prompt: promptTokens,
              reasoning: allocatedTokens[0] ?? 0,
              output: allocatedTokens[1] ?? 0,
              tools: allocatedTokens[2] ?? 0
            });
          }
        }
      }

      if (abortController.signal.aborted) { notifyAbort(); return; }

      if (!streamHadError && (assistantChunk.trim() || thinkingChunk.trim())) {
        const cleanedAssistant = sanitizeAccumulatedText(assistantChunk);
        conversationSteps.push({
          type: 'assistant',
          content: cleanedAssistant,
          thinkingContent: thinkingChunk || undefined,
          timestamp: Date.now()
        });
        if (cleanedAssistant) {
          continuationHistory.push({ role: 'assistant', content: cleanedAssistant });
        }
      }

      if (streamHadError) break;

      const pendingAfter = countPendingSteps();
      const currentSignature = computeActionSignature();
      debugLog(`[context] continuation after-pass ${summarizeContinuationHistory(continuationHistory)} toolLedgerEntries=${continuationToolLedger.length} pendingAfter=${pendingAfter} toolCalls=${continuationToolCalls}`);

      if (continuationToolCalls === 0 && pendingAfter >= pendingBefore) {
        debugLog(`[continuation] no progress detected (toolCalls=${continuationToolCalls} pendingBefore=${pendingBefore} pendingAfter=${pendingAfter}), stopping`);
        break;
      }

      if (lastActionSignature && currentSignature === lastActionSignature) {
        debugLog(`[continuation] loop detected (same actions repeated), stopping`);
        break;
      }

      if (continuationToolCalls === 0) {
        debugLog(`[continuation] no tool calls in continuation, agent likely finished`);
        break;
      }

      lastActionSignature = currentSignature;
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
    debugLog(`[agent] stream saved conversationId=${conversationId} steps=${conversationSteps.length} totalSteps=${stepCount} tokens=${totalTokens.total}`);

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
          if (!compacted.didCompact) return prev;
          pendingCompactTokensRef.current = compacted.estimatedTokens;
          const autoCompactDisplay = buildCompactionDisplay('auto', usedTokens, maxContextTokens, compacted.estimatedTokens);
          const compactNotice: Message = {
            id: createId(),
            role: "slash",
            content: autoCompactDisplay,
            success: true
          };
          return [compactNotice, ...compacted.messages];
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
    debugLog(`[agent] stream ERROR conversationId=${conversationId} message="${toLogPreview(errorMessage, 600)}"`);
    const errorContent = formatErrorMessage('Mosaic', errorMessage, {
      source: 'runtime',
      provider: config.provider,
      model: config.model,
    });
    setChatError(errorContent);
  } finally {
    if (abortControllerRef.current === abortController) {
      abortControllerRef.current = null;
    }
    const finalDuration = responseDuration ?? (Date.now() - localStartTime);
    debugLog(`[agent] stream end conversationId=${conversationId} aborted=${abortController.signal.aborted} streamDisposed=${disposedRef.current} durationMs=${finalDuration} pendingChanges=${hasPendingChanges()} tokens={prompt:${totalTokens.prompt},completion:${totalTokens.completion},total:${totalTokens.total}}`);
    if (!disposedRef.current) {
      const duration = finalDuration;
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
        await processPendingReviews();
      }

      if (totalReviewedKept > 0 || totalReviewedReverted > 0) {
        debugLog(`[review] stream summary kept=${totalReviewedKept} reverted=${totalReviewedReverted}`);
      }

      setIsProcessing(false);
      setProcessingStartTime(null);
    }
  }
}
