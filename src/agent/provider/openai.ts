import { streamText, CoreMessage, CoreTool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { z } from 'zod';
import { shouldEnableReasoning } from './reasoning';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';

function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return unwrapOptional(schema.unwrap());
  }
  if (schema instanceof z.ZodEffects) {
    const inner = unwrapOptional(schema.innerType());
    return inner === schema.innerType() ? schema : new z.ZodEffects({
      ...schema._def,
      schema: inner,
    });
  }
  return schema;
}

function makeAllPropertiesRequired(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) {
    const innerTransformed = makeAllPropertiesRequired(schema.innerType());
    return new z.ZodEffects({
      ...schema._def,
      schema: innerTransformed,
    });
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const newShape: Record<string, z.ZodTypeAny> = {};
    for (const key in shape) {
      let fieldSchema = shape[key];
      fieldSchema = unwrapOptional(fieldSchema);
      if (fieldSchema instanceof z.ZodObject) {
        fieldSchema = makeAllPropertiesRequired(fieldSchema);
      } else if (fieldSchema instanceof z.ZodArray) {
        const innerType = fieldSchema.element;
        if (innerType instanceof z.ZodObject) {
          fieldSchema = z.array(makeAllPropertiesRequired(innerType));
        }
      } else if (fieldSchema instanceof z.ZodEffects) {
        const innerType = fieldSchema.innerType();
        if (innerType instanceof z.ZodObject) {
          fieldSchema = new z.ZodEffects({
            ...fieldSchema._def,
            schema: makeAllPropertiesRequired(innerType),
          });
        }
      }
      newShape[key] = fieldSchema;
    }
    return z.object(newShape);
  }
  return schema;
}

function transformToolsForResponsesApi(
  tools: Record<string, CoreTool> | undefined
): Record<string, CoreTool> | undefined {
  if (!tools) return tools;

  const transformed: Record<string, CoreTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as any;
    if (t.parameters) {
      transformed[name] = {
        ...t,
        parameters: makeAllPropertiesRequired(t.parameters),
      };
    } else {
      transformed[name] = tool;
    }
  }
  return transformed;
}

export class OpenAIProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    const reasoningEnabled = await shouldEnableReasoning(config.provider, cleanModel);

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

    const runOnce = async function* (
      endpoint: OpenAIEndpoint,
      strictJsonSchema: boolean
    ): AsyncGenerator<AgentEvent> {
      const toolsToUse =
        endpoint === 'responses'
          ? transformToolsForResponsesApi(config.tools)
          : config.tools;

      const result = streamText({
        model: pickModel(endpoint),
        messages: messages,
        system: config.systemPrompt,
        tools: toolsToUse,
        maxSteps: config.maxSteps ?? 100,
        abortSignal: options?.abortSignal,
        providerOptions: {
          openai: {
            strictJsonSchema,
            ...(reasoningEnabled ? { reasoningEffort: 'high' } : {}),
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

          case 'error': {
            const err = normalizeError(c.error);
            const decision = getRetryDecision(err);
            if (decision.shouldRetry) {
              throw err;
            }
            yield {
              type: 'error',
              error: err.message,
            };
            break;
          }
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
      yield* runWithRetry(
        () => runOnce('responses', false),
        { abortSignal: options?.abortSignal }
      );
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      const msg = error instanceof Error ? error.message : String(error);

      const fallbackEndpoint = classifyEndpointError(msg);
      if (fallbackEndpoint && fallbackEndpoint !== 'responses') {
        try {
          yield* runWithRetry(
            () => runOnce(fallbackEndpoint, false),
            { abortSignal: options?.abortSignal }
          );
          return;
        } catch (endpointError) {
          if (options?.abortSignal?.aborted) return;
          const endpointMsg = endpointError instanceof Error ? endpointError.message : String(endpointError);
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
