import { CoreMessage } from 'ai';
import {
  AgentEvent,
  AgentMessage,
  ProviderConfig,
  Provider,
  ProviderSendOptions,
} from './types';
import { readConfig } from '../utils/config';
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from './prompts/systemPrompt';
import { getTools } from './tools/definitions';
import { AnthropicProvider } from './provider/anthropic';
import { OpenAIProvider } from './provider/openai';
import { GoogleProvider } from './provider/google';
import { MistralProvider } from './provider/mistral';
import { XaiProvider } from './provider/xai';
import { OllamaProvider, checkAndStartOllama } from './provider/ollama';
import { getModelsDevContextLimit } from '../utils/models';
import { estimateTokensFromText, estimateTokensForContent, getDefaultContextBudget } from '../utils/tokenEstimator';
import { setExploreContext } from '../utils/exploreBridge';

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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function summarizeMessage(message: CoreMessage, isLastUser: boolean): string {
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
    return `[tool:${toolName} ${status}] ${truncateText(cleaned, 120)}`;
  }

  if (message.role === 'assistant') {
    const text = contentToText(message.content);
    const cleaned = normalizeWhitespace(text);
    const sentenceMatch = cleaned.match(/^[^.!?\n]{10,}[.!?]/);
    const summary = sentenceMatch ? sentenceMatch[0] : cleaned;
    return `assistant: ${truncateText(summary, 200)}`;
  }

  const cleaned = normalizeWhitespace(contentToText(message.content));
  const limit = isLastUser ? cleaned.length : 400;
  return `user: ${truncateText(cleaned, limit)}`;
}

function buildSummary(messages: CoreMessage[], maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 3);
  const header = 'CONVERSATION SUMMARY (auto):';
  let charCount = header.length + 1;
  const lines: string[] = [];

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') { lastUserIndex = i; break; }
  }

  for (let i = 0; i < messages.length; i++) {
    if (charCount >= maxChars) break;
    const line = `- ${summarizeMessage(messages[i]!, i === lastUserIndex)}`;
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
  provider?: string
): CoreMessage[] {
  const budget = maxContextTokens ?? getDefaultContextBudget(provider);
  const systemTokens = estimateTokensFromText(systemPrompt) + 8;
  const messagesTokens = estimateTokensForMessages(messages);
  const total = systemTokens + messagesTokens;

  if (total <= budget) return messages;

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

  const summary = buildSummary(older, summaryTokens);
  const summaryMessage: CoreMessage = { role: 'assistant', content: summary };

  return [summaryMessage, ...recent];
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

    if (msg.role === 'tool' && recentFiles.size < 15) {
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

  if (recentFiles.size > 0) {
    parts.push(`Files recently accessed:\n${[...recentFiles].map(f => `- ${f}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

export class Agent {
  private messageHistory: CoreMessage[] = [];
  private provider: Provider;
  private config: ProviderConfig;
  private static ollamaChecked = false;
  private resolvedMaxContextTokens?: number;

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

    const systemPrompt = processSystemPrompt(rawSystemPrompt, true, mcpToolInfos);
    const tools = getTools();

    this.config = {
      provider: userConfig.provider,
      model: userConfig.model,
      apiKey: userConfig.apiKey,
      systemPrompt,
      tools,
      maxSteps: userConfig.maxSteps ?? 100,
      maxContextTokens: userConfig.maxContextTokens,
    };

    this.provider = this.createProvider(userConfig.provider);
  }

  private createProvider(providerName: string): Provider {
    switch (providerName) {
      case 'openai':
        return new OpenAIProvider();
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
    this.messageHistory.push({
      role: 'user',
      content: userMessage,
    });

    try {
      if (this.resolvedMaxContextTokens === undefined) {
        const resolved = await getModelsDevContextLimit(this.config.provider, this.config.model);
        if (typeof resolved === 'number') {
          this.resolvedMaxContextTokens = resolved;
          if (!this.config.maxContextTokens) {
            this.config = { ...this.config, maxContextTokens: resolved };
          }
        }
      }
      const compacted = compactMessages(
        this.messageHistory,
        this.config.systemPrompt,
        this.config.maxContextTokens ?? this.resolvedMaxContextTokens,
        this.config.provider
      );
      setExploreContext(buildExploreContext(this.messageHistory));
      yield* this.provider.sendMessage(compacted, this.config, options);
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async *streamMessages(messages: AgentMessage[], options?: ProviderSendOptions): AsyncGenerator<AgentEvent> {
    this.messageHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })) as CoreMessage[];

    try {
      if (this.resolvedMaxContextTokens === undefined) {
        const resolved = await getModelsDevContextLimit(this.config.provider, this.config.model);
        if (typeof resolved === 'number') {
          this.resolvedMaxContextTokens = resolved;
          if (!this.config.maxContextTokens) {
            this.config = { ...this.config, maxContextTokens: resolved };
          }
        }
      }
      const compacted = compactMessages(
        this.messageHistory,
        this.config.systemPrompt,
        this.config.maxContextTokens ?? this.resolvedMaxContextTokens,
        this.config.provider
      );
      setExploreContext(buildExploreContext(this.messageHistory));
      yield* this.provider.sendMessage(compacted, this.config, options);
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

  clearHistory(): void {
    this.messageHistory = [];
  }

  updateConfig(updates: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
