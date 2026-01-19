import { CoreMessage, CoreTool } from 'ai';
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

export class Agent {
  private messageHistory: CoreMessage[] = [];
  private provider: Provider;
  private config: ProviderConfig;
  private static ollamaChecked = false;

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
    const systemPrompt = processSystemPrompt(rawSystemPrompt, true);
    const tools = getTools();

    this.config = {
      provider: userConfig.provider,
      model: userConfig.model,
      apiKey: userConfig.apiKey,
      systemPrompt,
      tools,
      maxSteps: 60,
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
      yield* this.provider.sendMessage(this.messageHistory, this.config, options);
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
    }));

    try {
      yield* this.provider.sendMessage(this.messageHistory, this.config, options);
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