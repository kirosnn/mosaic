import { CoreMessage } from 'ai';
import { readConfig } from '../utils/config';
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from './prompts/systemPrompt';
import { sendToOpenAI } from './provider/openai';
import { sendToAnthropic } from './provider/anthropic';
import { sendToGoogle } from './provider/google';
import { sendToMistral } from './provider/mistral';
import { sendToXai } from './provider/xai';
import { sendToOllama } from './provider/ollama';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function* sendMessage(messages: AgentMessage[]): AsyncGenerator<string> {
  const config = readConfig();

  if (!config.provider || !config.model) {
    throw new Error('No provider or model configured. Please run setup first.');
  }

  const rawSystemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = processSystemPrompt(rawSystemPrompt);

  const coreMessages: CoreMessage[] = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  try {
    switch (config.provider) {
      case 'openai':
        yield* sendToOpenAI(coreMessages, config.model, config.apiKey, systemPrompt);
        break;

      case 'anthropic':
        yield* sendToAnthropic(coreMessages, config.model, config.apiKey, systemPrompt);
        break;

      case 'google':
        yield* sendToGoogle(coreMessages, config.model, config.apiKey, systemPrompt);
        break;

      case 'mistral':
        yield* sendToMistral(coreMessages, config.model, config.apiKey, systemPrompt);
        break;

      case 'xai':
        yield* sendToXai(coreMessages, config.model, config.apiKey, systemPrompt);
        break;

      case 'ollama':
        yield* sendToOllama(messages, config.model, systemPrompt);
        break;

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`AI Error: ${error.message}`);
    }
    throw new Error('An unknown error occurred while communicating with the AI provider');
  }
}