import { streamText, CoreMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AgentEvent, Provider, ProviderConfig } from '../types';

export class GoogleProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig
  ): AsyncGenerator<AgentEvent> {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
    });

    const result = streamText({
      model: google(config.model),
      messages: messages,
      system: config.systemPrompt,
      tools: config.tools,
      maxSteps: config.maxSteps || 10,
    });

    try {
      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            yield {
              type: 'text-delta',
              content: chunk.textDelta,
            };
            break;

          case 'step-start':
            yield {
              type: 'step-start',
              stepNumber: chunk.stepIndex,
            };
            break;

          case 'step-finish':
            yield {
              type: 'step-finish',
              stepNumber: chunk.stepIndex,
              finishReason: chunk.finishReason,
            };
            break;

          case 'tool-call':
            yield {
              type: 'tool-call-end',
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: chunk.args,
            };
            break;

          case 'tool-result':
            yield {
              type: 'tool-result',
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              result: chunk.result,
            };
            break;

          case 'finish':
            yield {
              type: 'finish',
              finishReason: chunk.finishReason,
              usage: chunk.usage,
            };
            break;

          case 'error':
            yield {
              type: 'error',
              error: chunk.error.message || 'Unknown error',
            };
            break;
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
