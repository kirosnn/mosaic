import { CoreMessage } from 'ai';
import {
  AgentEvent,
  AgentMessage,
  ProviderConfig,
  Provider,
  ProviderSendOptions,
} from './types';
import { readConfig, getApiKeyForProvider, getAuthForProvider } from '../utils/config';
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from './prompts/systemPrompt';
import { getTools } from './tools/definitions';
import { AnthropicProvider } from './provider/anthropic';
import { OpenAIProvider } from './provider/openai';
import { OpenRouterProvider } from './provider/openrouter';
import { GoogleProvider } from './provider/google';
import { MistralProvider } from './provider/mistral';
import { XaiProvider } from './provider/xai';
import { OllamaProvider, checkAndStartOllama } from './provider/ollama';
import { getModelsDevContextLimit, getModelsDevOutputLimit } from '../utils/models';
import { estimateTokensFromText, estimateTokensForContent, getDefaultContextBudget } from '../utils/tokenEstimator';
import { setExploreContext, getExploreSummaries, setConversationMemory, resetExploreSummaries } from '../utils/exploreBridge';
import { debugLog } from '../utils/debug';
import { resetTracker, clearPersistentCache } from './tools/toolCallTracker';
import { ConversationMemory, getGlobalMemory, resetGlobalMemory } from './memory';

function contentToText(content: CoreMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';

  if (Array.isArray(content)) {
    const text = content
      .map((part: any) => {
        if (part && typeof part.text === 'string') return part.text;
        if (typeof part === 'string') return part;
        return '';
      })
      .filter(Boolean)
      .join('');

    if (text) return text;
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function estimateTokensForMessages(messages: CoreMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokensForContent(contentToText(message.content));
  }
  return total;
}

function countRoles(messages: CoreMessage[]): { user: number; assistant: number; tool: number; other: number } {
  let user = 0;
  let assistant = 0;
  let tool = 0;
  let other = 0;
  for (const message of messages) {
    if (message.role === 'user') user++;
    else if (message.role === 'assistant') assistant++;
    else if (message.role === 'tool') tool++;
    else other++;
  }
  return { user, assistant, tool, other };
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof args.path === 'string' && args.path.trim()) parts.push(`path=${args.path}`);
  if (typeof args.query === 'string' && args.query.trim()) parts.push(`query=${truncateText(args.query, 60)}`);
  if (typeof args.pattern === 'string' && args.pattern.trim()) parts.push(`pattern=${truncateText(args.pattern, 60)}`);
  if (typeof args.url === 'string' && args.url.trim()) parts.push(`url=${truncateText(args.url, 80)}`);
  if (typeof args.command === 'string' && args.command.trim()) parts.push(`command=${truncateText(args.command, 80)}`);
  if (parts.length > 0) return parts.join(' ');
  const raw = JSON.stringify(args);
  return `args=${truncateText(raw, 120)}`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function summarizeMessage(message: CoreMessage, isLastUser: boolean, isFirstUser: boolean = false): string {
  if (message.role === 'tool') {
    const content: any = message.content;
    const part = Array.isArray(content) ? content[0] : undefined;
    const toolName = part?.toolName ?? part?.tool_name ?? 'tool';
    let resultText = '';
    if (part?.result !== undefined) {
      if (typeof part.result === 'string') resultText = part.result;
      else {
        try {
          resultText = JSON.stringify(part.result);
        } catch {
          resultText = String(part.result);
        }
      }
    } else {
      resultText = contentToText(message.content);
    }
    const isError = resultText.toLowerCase().includes('error') || resultText.toLowerCase().includes('failed');
    const status = isError ? 'FAILED' : 'OK';
    const cleaned = normalizeWhitespace(resultText);
    const toolLimit = toolName === 'explore' ? 1000 : toolName === 'plan' ? 600 : toolName === 'glob' || toolName === 'grep' || toolName === 'read' ? 300 : 120;
    return `[tool:${toolName} ${status}] ${truncateText(cleaned, toolLimit)}`;
  }

  if (message.role === 'assistant') {
    const text = contentToText(message.content);
    const cleaned = normalizeWhitespace(text);
    const sentenceMatch = cleaned.match(/^[^.!?\n]{10,}[.!?]/);
    const summary = sentenceMatch ? sentenceMatch[0] : cleaned;
    return `assistant: ${truncateText(summary, 200)}`;
  }

  const cleaned = normalizeWhitespace(contentToText(message.content));
  const limit = (isLastUser || isFirstUser) ? cleaned.length : 400;
  return `user: ${truncateText(cleaned, limit)}`;
}

function extractOriginalUserInstruction(messages: CoreMessage[]): string {
  for (const msg of messages) {
    if (msg.role === 'user') {
      return contentToText(msg.content);
    }
  }
  return '';
}

function extractLastPlanState(messages: CoreMessage[]): { steps: Array<{ step: string; status: string }>; explanation?: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== 'tool') continue;
    const content: any = msg.content;
    const part = Array.isArray(content) ? content[0] : undefined;
    const toolName = part?.toolName ?? part?.tool_name;
    if (toolName !== 'plan') continue;
    const result = part?.result;
    if (result && typeof result === 'object' && Array.isArray(result.plan)) {
      return {
        steps: result.plan.map((s: any) => ({
          step: typeof s.step === 'string' ? s.step : '',
          status: typeof s.status === 'string' ? s.status : 'pending',
        })).filter((s: any) => s.step.trim()),
        explanation: typeof result.explanation === 'string' ? result.explanation : undefined,
      };
    }
  }
  return null;
}

function buildTaskReminder(messages: CoreMessage[]): string {
  const parts: string[] = [];

  const originalInstruction = extractOriginalUserInstruction(messages);
  if (originalInstruction) {
    parts.push(`ORIGINAL USER REQUEST:\n${truncateText(normalizeWhitespace(originalInstruction), 1000)}`);
  }

  const planState = extractLastPlanState(messages);
  if (planState) {
    const planLines: string[] = [];
    for (const s of planState.steps) {
      const marker = s.status === 'completed' ? '[DONE]' : s.status === 'in_progress' ? '[IN PROGRESS]' : '[PENDING]';
      planLines.push(`${marker} ${s.step}`);
    }
    const pending = planState.steps.filter(s => s.status !== 'completed').length;
    parts.push(`CURRENT PLAN (${pending} remaining):\n${planLines.join('\n')}`);
  }

  return parts.join('\n\n');
}

function buildSummary(messages: CoreMessage[], maxTokens: number, memory?: ConversationMemory): string {
  const maxChars = Math.max(0, maxTokens * 3);

  const taskReminder = buildTaskReminder(messages);

  let memoryBlock = '';
  if (memory) {
    const memoryBudget = Math.floor(maxChars * 0.3);
    const memCtx = memory.buildMemoryContext(memoryBudget);
    if (memCtx) {
      memoryBlock = `\nMEMORY INDEX:\n${memCtx}\n`;
    }
  }

  const header = taskReminder
    ? `${taskReminder}${memoryBlock}\n\nCONVERSATION SUMMARY (auto):`
    : `${memoryBlock}\nCONVERSATION SUMMARY (auto):`;
  let charCount = header.length + 1;
  const lines: string[] = [];

  let lastUserIndex = -1;
  let firstUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === 'user') {
      firstUserIndex = i;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    if (charCount >= maxChars) break;
    const line = `- ${summarizeMessage(messages[i]!, i === lastUserIndex, i === firstUserIndex)}`;
    charCount += line.length + 1;
    lines.push(line);
  }
  const body = lines.join('\n');
  const full = `${header}\n${body}`.trim();
  return truncateText(full, maxChars);
}

function compactMessages(
  messages: CoreMessage[],
  systemPrompt: string,
  maxContextTokens?: number,
  provider?: string,
  memory?: ConversationMemory
): CoreMessage[] {
  const budget = maxContextTokens ?? getDefaultContextBudget(provider);
  const systemTokens = estimateTokensFromText(systemPrompt) + 8;
  const messagesTokens = estimateTokensForMessages(messages);
  const total = systemTokens + messagesTokens;

  if (total <= budget) {
    debugLog(`[compaction] skipped reason=within_budget totalTokens=${total} budgetTokens=${budget} systemTokens=${systemTokens} messageTokens=${messagesTokens} historyLen=${messages.length}`);
    return messages;
  }

  const summaryTokens = Math.min(2000, Math.max(400, Math.floor(budget * 0.2)));
  const recentBudget = Math.max(500, budget - summaryTokens);

  let recentTokens = 0;
  const recent: CoreMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const msgTokens = estimateTokensForContent(contentToText(message.content));
    if (recentTokens + msgTokens > recentBudget && recent.length > 0) break;
    recent.unshift(message);
    recentTokens += msgTokens;
  }

  const cutoff = messages.length - recent.length;
  const older = cutoff > 0 ? messages.slice(0, cutoff) : [];

  if (older.length === 0) return recent;

  const summary = buildSummary(older, summaryTokens, memory);
  const summaryMessage: CoreMessage = { role: 'assistant', content: summary };
  const compacted = [summaryMessage, ...recent];
  const compactedTokens = systemTokens + estimateTokensForMessages(compacted);

  const stats = memory?.getStats();
  debugLog(`[compaction] applied totalTokens=${total} -> ${compactedTokens} budgetTokens=${budget} historyLen=${messages.length} older=${older.length} keptRecent=${recent.length} summaryChars=${summary.length} summaryBudgetTokens=${summaryTokens} recentBudgetTokens=${recentBudget} memory={files:${stats?.files ?? 0},searches:${stats?.searches ?? 0},toolCalls:${stats?.toolCalls ?? 0}}`);

  return compacted;
}

function buildExploreContext(messages: CoreMessage[]): string {
  const parts: string[] = [];

  const userMessages: string[] = [];
  const recentFiles = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;

    if (msg.role === 'user' && userMessages.length < 2) {
      const text = normalizeWhitespace(contentToText(msg.content));
      if (text) userMessages.unshift(truncateText(text, 300));
    }

    if (msg.role === 'tool' && recentFiles.size < 30) {
      const content: any = msg.content;
      const part = Array.isArray(content) ? content[0] : undefined;
      const toolName = part?.toolName ?? part?.tool_name;
      if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
        const args = part?.args ?? part?.input;
        const path = args?.path;
        if (typeof path === 'string') recentFiles.add(path);
      }
    }
  }

  if (userMessages.length > 0) {
    parts.push(`User intent:\n${userMessages.map(m => `- ${m}`).join('\n')}`);
  }

  const summaries = getExploreSummaries();
  if (summaries.length > 0) {
    let summariesText = '';
    let charBudget = 2000;
    for (let i = summaries.length - 1; i >= 0 && charBudget > 0; i--) {
      const entry = `[Explore #${i + 1}] ${summaries[i]!}`;
      if (entry.length <= charBudget) {
        summariesText = entry + '\n' + summariesText;
        charBudget -= entry.length;
      } else {
        summariesText = entry.slice(0, charBudget) + '...\n' + summariesText;
        break;
      }
    }
    parts.push(`Previous explore findings:\n${summariesText.trim()}`);
  }

  if (recentFiles.size > 0) {
    parts.push(`Files recently accessed:\n${[...recentFiles].map(f => `- ${f}`).join('\n')}`);
  }

  const context = parts.join('\n\n');
  debugLog(`[context] exploreContext built chars=${context.length} userHints=${userMessages.length} previousExploreSummaries=${summaries.length} recentFiles=${recentFiles.size}`);
  return context;
}

export class Agent {
  private messageHistory: CoreMessage[] = [];
  private provider: Provider;
  private config: ProviderConfig;
  private static ollamaChecked = false;
  private resolvedMaxContextTokens?: number;
  private resolvedMaxOutputTokens?: number;
  private memory: ConversationMemory;
  private pendingToolCalls = new Map<string, { toolName: string; args: Record<string, unknown> }>();

  static resetSessionState(): void {
    resetGlobalMemory();
    resetTracker();
    clearPersistentCache();
    resetExploreSummaries();
    try {
      const { resetExploreKnowledge } = require('./tools/exploreExecutor');
      if (typeof resetExploreKnowledge === 'function') {
        resetExploreKnowledge();
      }
    } catch {
    }
  }

  static async ensureProviderReady(): Promise<{ ready: boolean; started?: boolean; error?: string }> {
    const userConfig = readConfig();

    if (userConfig.provider === 'ollama') {
      if (Agent.ollamaChecked) {
        return { ready: true };
      }

      const result = await checkAndStartOllama();
      Agent.ollamaChecked = true;

      if (!result.running) {
        return { ready: false, error: result.error };
      }

      return { ready: true, started: result.started };
    }

    return { ready: true };
  }

  constructor() {
    const userConfig = readConfig();

    if (!userConfig.provider || !userConfig.model) {
      throw new Error('No provider or model configured. Please run setup first.');
    }

    const rawSystemPrompt = userConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    let mcpToolInfos: Array<{ serverId: string; name: string; description: string; inputSchema: Record<string, unknown>; canonicalId: string; safeId: string }> | undefined;
    try {
      const { getMcpCatalog, isMcpInitialized } = require('../mcp/index');
      if (isMcpInitialized()) {
        mcpToolInfos = getMcpCatalog().getMcpToolInfos();
      }
    } catch {
      // MCP not available
    }

    const systemPrompt = processSystemPrompt(rawSystemPrompt, true, mcpToolInfos, { consumeOneShotSkills: true });
    const tools = getTools();
    const auth = getAuthForProvider(userConfig.provider);

    this.config = {
      provider: userConfig.provider,
      model: userConfig.model,
      apiKey: auth?.type === 'api_key' ? auth.apiKey : getApiKeyForProvider(userConfig.provider) ?? userConfig.apiKey,
      auth,
      systemPrompt,
      tools,
      maxSteps: userConfig.maxSteps ?? 100,
      maxContextTokens: userConfig.maxContextTokens,
    };

    this.provider = this.createProvider(userConfig.provider);
    this.memory = getGlobalMemory();

    debugLog(`[agent] initialized provider=${userConfig.provider} model=${userConfig.model} tools=${Object.keys(tools).length} maxSteps=${this.config.maxSteps} memory={files:${this.memory.getStats().files}}`);
  }

  private createProvider(providerName: string): Provider {
    switch (providerName) {
      case 'openai':
        return new OpenAIProvider();
      case 'openrouter':
        return new OpenRouterProvider();
      case 'anthropic':
        return new AnthropicProvider();
      case 'google':
        return new GoogleProvider();
      case 'mistral':
        return new MistralProvider();
      case 'xai':
        return new XaiProvider();
      case 'ollama':
        return new OllamaProvider();
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  async *sendMessage(userMessage: string, options?: ProviderSendOptions): AsyncGenerator<AgentEvent> {
    const messagePreview = userMessage.slice(0, 100).replace(/[\r\n]+/g, ' ');
    debugLog(`[agent] sendMessage start msgLen=${userMessage.length} preview="${messagePreview}"`);

    this.memory.incrementTurn();
    resetTracker();

    this.messageHistory.push({
      role: 'user',
      content: userMessage,
    });
    const preRoles = countRoles(this.messageHistory);
    debugLog(`[context] sendMessage historyLen=${this.messageHistory.length} roles={user:${preRoles.user},assistant:${preRoles.assistant},tool:${preRoles.tool},other:${preRoles.other}} estTokens=${estimateTokensForMessages(this.messageHistory)} alreadyCompacted=${options?.alreadyCompacted === true}`);

    try {
      if (this.resolvedMaxContextTokens === undefined) {
        const [ctxLimit, outLimit] = await Promise.all([
          getModelsDevContextLimit(this.config.provider, this.config.model),
          getModelsDevOutputLimit(this.config.provider, this.config.model),
        ]);
        if (typeof ctxLimit === 'number') {
          this.resolvedMaxContextTokens = ctxLimit;
          if (!this.config.maxContextTokens) {
            this.config = { ...this.config, maxContextTokens: ctxLimit };
          }
        }
        if (typeof outLimit === 'number') {
          this.resolvedMaxOutputTokens = outLimit;
          this.config = { ...this.config, maxOutputTokens: outLimit };
        }
      }
      const shouldCompact = !options?.alreadyCompacted;
      const compacted = shouldCompact
        ? compactMessages(
          this.messageHistory,
          this.config.systemPrompt,
          this.config.maxContextTokens ?? this.resolvedMaxContextTokens,
          this.config.provider,
          this.memory
        )
        : this.messageHistory;
      const postRoles = countRoles(compacted);
      debugLog(`[agent] sending to provider historyLen=${this.messageHistory.length} compactedLen=${compacted.length} compacted=${shouldCompact} contextLimit=${this.config.maxContextTokens ?? 'default'} outputLimit=${this.config.maxOutputTokens ?? 'default'} roles={user:${postRoles.user},assistant:${postRoles.assistant},tool:${postRoles.tool},other:${postRoles.other}} estTokens=${estimateTokensForMessages(compacted)}`);
      const exploreContext = buildExploreContext(this.messageHistory);
      setExploreContext(exploreContext);
      debugLog(`[context] sendMessage exploreContextChars=${exploreContext.length} sourceHistoryLen=${this.messageHistory.length}`);
      setConversationMemory(this.memory);

      for await (const event of this.provider.sendMessage(compacted, this.config, options)) {
        this.recordEvent(event);
        yield event;
      }

      const stats = this.memory.getStats();
      debugLog(`[agent] sendMessage complete memory={files:${stats.files}, searches:${stats.searches}, toolCalls:${stats.toolCalls}}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      debugLog(`[agent] sendMessage ERROR ${errorMsg.slice(0, 150)}`);
      yield {
        type: 'error',
        error: errorMsg,
      };
    }
  }

  async *streamMessages(messages: AgentMessage[], options?: ProviderSendOptions): AsyncGenerator<AgentEvent> {
    this.memory.incrementTurn();
    resetTracker();
    this.messageHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })) as CoreMessage[];
    const preRoles = countRoles(this.messageHistory);
    debugLog(`[context] streamMessages historyLen=${this.messageHistory.length} roles={user:${preRoles.user},assistant:${preRoles.assistant},tool:${preRoles.tool},other:${preRoles.other}} estTokens=${estimateTokensForMessages(this.messageHistory)} alreadyCompacted=${options?.alreadyCompacted === true}`);

    try {
      if (this.resolvedMaxContextTokens === undefined) {
        const [ctxLimit, outLimit] = await Promise.all([
          getModelsDevContextLimit(this.config.provider, this.config.model),
          getModelsDevOutputLimit(this.config.provider, this.config.model),
        ]);
        if (typeof ctxLimit === 'number') {
          this.resolvedMaxContextTokens = ctxLimit;
          if (!this.config.maxContextTokens) {
            this.config = { ...this.config, maxContextTokens: ctxLimit };
          }
        }
        if (typeof outLimit === 'number') {
          this.resolvedMaxOutputTokens = outLimit;
          this.config = { ...this.config, maxOutputTokens: outLimit };
        }
      }
      const shouldCompact = !options?.alreadyCompacted;
      const compacted = shouldCompact
        ? compactMessages(
          this.messageHistory,
          this.config.systemPrompt,
          this.config.maxContextTokens ?? this.resolvedMaxContextTokens,
          this.config.provider,
          this.memory
        )
        : this.messageHistory;
      const postRoles = countRoles(compacted);
      debugLog(`[agent] streamMessages historyLen=${this.messageHistory.length} compactedLen=${compacted.length} compacted=${shouldCompact} contextLimit=${this.config.maxContextTokens ?? 'default'} roles={user:${postRoles.user},assistant:${postRoles.assistant},tool:${postRoles.tool},other:${postRoles.other}} estTokens=${estimateTokensForMessages(compacted)}`);
      const exploreContext = buildExploreContext(this.messageHistory);
      setExploreContext(exploreContext);
      debugLog(`[context] streamMessages exploreContextChars=${exploreContext.length} sourceHistoryLen=${this.messageHistory.length}`);
      setConversationMemory(this.memory);

      for await (const event of this.provider.sendMessage(compacted, this.config, options)) {
        this.recordEvent(event);
        yield event;
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  getHistory(): CoreMessage[] {
    return [...this.messageHistory];
  }

  getMemory(): ConversationMemory {
    return this.memory;
  }

  clearHistory(): void {
    this.messageHistory = [];
    this.pendingToolCalls.clear();
    Agent.resetSessionState();
    this.memory = getGlobalMemory();
  }

  private recordEvent(event: AgentEvent): void {
    if (event.type === 'tool-call-end') {
      this.pendingToolCalls.set(event.toolCallId, {
        toolName: event.toolName,
        args: event.args,
      });
    }

    if (event.type === 'tool-result') {
      const pending = this.pendingToolCalls.get(event.toolCallId);
      if (pending) {
        this.pendingToolCalls.delete(event.toolCallId);

        const resultStr = typeof event.result === 'string'
          ? event.result
          : (event.result ? JSON.stringify(event.result) : '').slice(0, 500);

        const resultObj = event.result as any;
        const isExplicitError = (
          (resultObj && typeof resultObj === 'object' && resultObj.error) ||
          (typeof event.result === 'string' && event.result.startsWith('Error:'))
        );
        const success = !isExplicitError;
        const preview = resultStr.slice(0, 200);

        this.memory.recordToolCall(pending.toolName, pending.args, preview, success);

        if (pending.toolName === 'read' && success && typeof pending.args.path === 'string') {
          this.memory.recordFileRead(pending.args.path, resultStr);
        }

        if ((pending.toolName === 'grep' || pending.toolName === 'glob') && success) {
          const query = typeof pending.args.query === 'string' ? pending.args.query : '';
          const pattern = typeof pending.args.pattern === 'string' ? pending.args.pattern : '';
          const path = typeof pending.args.path === 'string' ? pending.args.path : '';
          let filesFound = 0;
          let matchCount = 0;
          try {
            const parsed = JSON.parse(resultStr);
            if (Array.isArray(parsed)) {
              filesFound = parsed.length;
              matchCount = parsed.length;
            } else if (parsed && typeof parsed === 'object') {
              matchCount = typeof parsed.total_matches === 'number' ? parsed.total_matches : 0;
              filesFound = typeof parsed.files_with_matches === 'number' ? parsed.files_with_matches : 0;
            }
          } catch { }
          this.memory.recordSearch(query, pattern, path, filesFound, matchCount);
        }

        const stats = this.memory.getStats();
        debugLog(`[memory] recorded tool=${pending.toolName} success=${success} callId=${event.toolCallId} resultChars=${resultStr.length} ${summarizeArgs(pending.args)} memory={files:${stats.files},searches:${stats.searches},toolCalls:${stats.toolCalls}} preview="${preview.slice(0, 80)}"`);
      }
    }
  }

  updateConfig(updates: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
