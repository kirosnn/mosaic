import { streamText, CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AgentEvent, Provider, ProviderConfig } from '../types';

export class AnthropicProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig
  ): AsyncGenerator<AgentEvent> {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
    });

    const result = streamText({
      model: anthropic(config.model),
      messages: messages,
      system: config.systemPrompt,
      tools: config.tools,
      maxSteps: config.maxSteps || 10,
    });

    try {
      let stepCounter = 0;

      for await (const chunk of result.fullStream as any) {
        const c: any = chunk;
        switch (c.type) {
          case 'reasoning':
            if (c.textDelta) {
              yield {
                type: 'reasoning-delta',
                content: c.textDelta,
              };
            }
            break;

          case 'text-delta':
            yield {
              type: 'text-delta',
              content: c.textDelta,
            };
            break;

          case 'step-start':
            yield {
              type: 'step-start',
              stepNumber: typeof c.stepIndex === 'number' ? c.stepIndex : stepCounter,
            };
            stepCounter++;
            break;

          case 'step-finish':
            yield {
              type: 'step-finish',
              stepNumber:
                typeof c.stepIndex === 'number' ? c.stepIndex : Math.max(0, stepCounter - 1),
              finishReason: String(c.finishReason ?? 'stop'),
            };
            break;

          case 'tool-call':
            yield {
              type: 'tool-call-end',
              toolCallId: String(c.toolCallId ?? ''),
              toolName: String(c.toolName ?? ''),
              args: (c.args ?? {}) as Record<string, unknown>,
            };
            break;

          case 'tool-result':
            yield {
              type: 'tool-result',
              toolCallId: String(c.toolCallId ?? ''),
              toolName: String(c.toolName ?? ''),
              result: c.result,
            };
            break;

          case 'finish':
            yield {
              type: 'finish',
              finishReason: String(c.finishReason ?? 'stop'),
              usage: c.usage,
            };
            break;

          case 'error':
            {
              const err = c.error;
              const msg =
                err instanceof Error
                  ? err.message
                  : typeof err === 'string'
                    ? err
                    : 'Unknown error';
            yield {
              type: 'error',
              error: msg,
            };
            }
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
