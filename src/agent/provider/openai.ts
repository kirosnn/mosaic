import { streamText, CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';

export class OpenAIProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

    const openai = createOpenAI({
      apiKey: cleanApiKey,
    });

    type OpenAIEndpoint = 'responses' | 'chat' | 'completion';

    const pickModel = (endpoint: OpenAIEndpoint) => {
      switch (endpoint) {
        case 'responses':
          return openai.responses(cleanModel);
        case 'chat':
          return openai.chat(cleanModel);
        case 'completion':
          return openai.completion(cleanModel);
      }
    };

    const run = async function* (
      endpoint: OpenAIEndpoint,
      strictJsonSchema: boolean
    ): AsyncGenerator<AgentEvent> {
      const result = streamText({
        model: pickModel(endpoint),
        messages: messages,
        system: config.systemPrompt,
        tools: config.tools,
        maxSteps: config.maxSteps ?? 10,
        abortSignal: options?.abortSignal,
        providerOptions: {
          openai: {
            strictJsonSchema,
            reasoningEffort: 'medium',
          },
        },
      });

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

      return;
    };

    const classifyEndpointError = (msg: string): OpenAIEndpoint | null => {
      const m = msg || '';
      if (m.includes('v1/chat/completions')) {
        if (m.toLowerCase().includes('not a chat model')) return 'responses';
      }
      if (m.includes('v1/responses')) {
        if (m.toLowerCase().includes('not supported') || m.toLowerCase().includes('unknown')) return 'chat';
      }
      if (m.includes('v1/completions')) {
        return 'completion';
      }
      if (m.toLowerCase().includes('did you mean to use v1/completions')) {
        return 'completion';
      }
      return null;
    };

    try {
      yield* run('responses', true);
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      const msg = error instanceof Error ? error.message : String(error);
      const looksLikeStrictSchemaError =
        msg.includes('Invalid schema for function') &&
        msg.includes('required') &&
        msg.includes('properties');

      if (looksLikeStrictSchemaError) {
        try {
          yield* run('responses', false);
          return;
        } catch (retryError) {
          if (options?.abortSignal?.aborted) return;
          yield {
            type: 'error',
            error: retryError instanceof Error ? retryError.message : 'Unknown error occurred',
          };
          return;
        }
      }

      const fallbackEndpoint = classifyEndpointError(msg);
      if (fallbackEndpoint && fallbackEndpoint !== 'responses') {
        try {
          yield* run(fallbackEndpoint, true);
          return;
        } catch (endpointError) {
          if (options?.abortSignal?.aborted) return;
          const endpointMsg = endpointError instanceof Error ? endpointError.message : String(endpointError);
          const strictSchemaFromFallback =
            endpointMsg.includes('Invalid schema for function') &&
            endpointMsg.includes('required') &&
            endpointMsg.includes('properties');

          if (strictSchemaFromFallback) {
            try {
              yield* run(fallbackEndpoint, false);
              return;
            } catch (endpointRetryError) {
              if (options?.abortSignal?.aborted) return;
              yield {
                type: 'error',
                error:
                  endpointRetryError instanceof Error
                    ? endpointRetryError.message
                    : 'Unknown error occurred',
              };
              return;
            }
          }

          yield {
            type: 'error',
            error: endpointMsg || 'Unknown error occurred',
          };
          return;
        }
      }

      yield {
        type: 'error',
        error: msg || 'Unknown error occurred',
      };
    }
  }
}