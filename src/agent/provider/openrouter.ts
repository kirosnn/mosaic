import { streamText, CoreMessage, CoreTool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { z } from 'zod';
import { getOpenAIReasoningOptions, resolveReasoningEnabled } from './reasoningConfig';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';
import { debugLog } from '../../utils/debug';
import { StreamSanitizer } from './streamSanitizer';
import { ContextGuard } from './contextGuard';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

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

function supportsReasoningEffort(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.startsWith('openai/')) return true;
  if (id.startsWith('x-ai/') || id.startsWith('xai/')) return true;
  if (id.includes('gpt-') || id.startsWith('gpt-')) return true;
  if (id.startsWith('o1') || id.startsWith('o3')) return true;
  if (id.includes('grok')) return true;
  return false;
}

export class OpenRouterProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(config.provider, cleanModel);
    const openaiReasoning = supportsReasoningEffort(cleanModel)
      ? getOpenAIReasoningOptions(reasoningEnabled)
      : undefined;

    debugLog(`[openrouter] starting stream model=${cleanModel} messagesLen=${messages.length} reasoning=${reasoningEnabled}`);

    const openrouter = createOpenAI({
      apiKey: cleanApiKey,
      baseURL: OPENROUTER_BASE_URL,
      compatibility: 'compatible',
      name: 'openrouter',
      headers: {
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'mosaic',
      },
    });

    type OpenRouterEndpoint = 'chat' | 'responses' | 'completion';

    const pickModel = (endpoint: OpenRouterEndpoint) => {
      switch (endpoint) {
        case 'chat':
          return openrouter.chat(cleanModel);
        case 'responses':
          return openrouter.responses(cleanModel as any);
        case 'completion':
          return openrouter.completion(cleanModel as any);
      }
    };

    const runOnce = async function* (
      endpoint: OpenRouterEndpoint
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
        maxTokens: config.maxOutputTokens ?? 16384,
        maxRetries: 0,
        abortSignal: options?.abortSignal,
        providerOptions: {
          openai: {
            strictJsonSchema: false,
            ...(openaiReasoning ?? {}),
          },
        },
      });

      let stepCounter = 0;
      let hasEmitted = false;
      const sanitizer = new StreamSanitizer();
      const contextGuard = new ContextGuard(config.maxContextTokens);

      for await (const chunk of result.fullStream as any) {
        const c: any = chunk;
        switch (c.type) {
          case 'reasoning':
            if (c.textDelta) {
              hasEmitted = true;
              yield {
                type: 'reasoning-delta',
                content: c.textDelta,
              };
            }
            break;

          case 'text-delta': {
            const safe = sanitizer.feed(c.textDelta);
            if (safe !== null) {
              hasEmitted = true;
              yield { type: 'text-delta', content: safe };
            }
            break;
          }

          case 'step-start':
            hasEmitted = true;
            sanitizer.reset();
            yield {
              type: 'step-start',
              stepNumber: typeof c.stepIndex === 'number' ? c.stepIndex : stepCounter,
            };
            stepCounter++;
            break;

          case 'step-finish':
            hasEmitted = true;
            yield {
              type: 'step-finish',
              stepNumber:
                typeof c.stepIndex === 'number' ? c.stepIndex : Math.max(0, stepCounter - 1),
              finishReason: String(c.finishReason ?? 'stop'),
            };
            break;

          case 'tool-call':
            hasEmitted = true;
            yield {
              type: 'tool-call-end',
              toolCallId: String(c.toolCallId ?? ''),
              toolName: String(c.toolName ?? ''),
              args: (c.args ?? {}) as Record<string, unknown>,
            };
            break;

          case 'tool-result':
            hasEmitted = true;
            contextGuard.trackToolResult(c.result);
            yield {
              type: 'tool-result',
              toolCallId: String(c.toolCallId ?? ''),
              toolName: String(c.toolName ?? ''),
              result: c.result,
            };
            if (contextGuard.shouldBreak()) {
              yield { type: 'finish', finishReason: 'length' };
              return;
            }
            break;

          case 'finish': {
            hasEmitted = true;
            const finishReason = String(c.finishReason ?? 'stop');
            const effectiveFinishReason = finishReason === 'stop' && sanitizer.wasTruncated()
              ? 'length'
              : finishReason;
            if (effectiveFinishReason !== finishReason) {
              debugLog('[openrouter] finish reason remapped stop->length due to sanitizer truncation');
            }
            yield {
              type: 'finish',
              finishReason: effectiveFinishReason,
              usage: c.usage,
            };
            break;
          }

          case 'error': {
            const err = normalizeError(c.error);
            const decision = getRetryDecision(err);
            if (decision.shouldRetry && !hasEmitted) {
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
    };

    const classifyEndpointError = (msg: string): OpenRouterEndpoint | null => {
      const m = msg || '';
      if (m.includes('v1/chat/completions')) {
        if (m.toLowerCase().includes('not a chat model')) return 'completion';
        if (m.toLowerCase().includes('not supported') || m.toLowerCase().includes('unknown')) return 'responses';
      }
      if (m.includes('v1/responses')) {
        if (m.toLowerCase().includes('not supported') || m.toLowerCase().includes('unknown')) return 'chat';
      }
      if (m.includes('v1/completions')) {
        if (m.toLowerCase().includes('not supported') || m.toLowerCase().includes('unknown')) return 'chat';
      }
      if (m.toLowerCase().includes('did you mean to use v1/completions')) {
        return 'completion';
      }
      return null;
    };

    try {
      yield* runWithRetry(
        () => runOnce('chat'),
        { abortSignal: options?.abortSignal, key: config.provider }
      );
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      const msg = error instanceof Error ? error.message : String(error);

      const fallbackEndpoint = classifyEndpointError(msg);
      if (fallbackEndpoint && fallbackEndpoint !== 'chat') {
        try {
          yield* runWithRetry(
            () => runOnce(fallbackEndpoint),
            { abortSignal: options?.abortSignal, key: config.provider }
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
