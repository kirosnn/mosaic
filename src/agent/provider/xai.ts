import { streamText, CoreMessage } from 'ai';
import { createXai } from '@ai-sdk/xai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';

export class XaiProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

    const xai = createXai({
      apiKey: cleanApiKey,
    });

    const result = streamText({
      model: xai(cleanModel),
      messages: messages,
      system: config.systemPrompt,
      tools: config.tools,
      maxSteps: config.maxSteps || 10,
      abortSignal: options?.abortSignal,
      providerOptions: {
        xai: {
          reasoningEffort: 'high',
        },
      },
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
      if (options?.abortSignal?.aborted) return;
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}