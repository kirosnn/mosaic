import { streamText, CoreMessage, CoreTool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { z } from 'zod';
import { getOpenAIReasoningOptions, resolveReasoningEnabled } from './reasoningConfig';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';
import { refreshOpenAIOAuthToken, decodeJwt } from '../../auth/oauth';
import { setOAuthTokenForProvider, mapModelForOAuth } from '../../utils/config';
import { debugLog, maskToken } from '../../utils/debug';
import { StreamSanitizer } from './streamSanitizer';

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
    let cleanModel = config.model.trim().replace(/[\r\n]+/g, '');

    let oauthAuth = config.auth?.type === 'oauth' ? config.auth : undefined;

    if (oauthAuth) {
      cleanModel = mapModelForOAuth(cleanModel);
    }

    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(config.provider, cleanModel);
    const openaiReasoning = getOpenAIReasoningOptions(reasoningEnabled);
    debugLog(`[openai] reasoning=${reasoningEnabled}`);

    const refreshOauthIfNeeded = async (): Promise<typeof oauthAuth> => {
      if (!oauthAuth?.refreshToken) return oauthAuth;
      if (oauthAuth.expiresAt && Date.now() < oauthAuth.expiresAt - 60000) return oauthAuth;
      const refreshed = await refreshOpenAIOAuthToken(oauthAuth.refreshToken);
      if (!refreshed) return oauthAuth;
      const updated = {
        type: 'oauth' as const,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        tokenType: refreshed.tokenType,
        scope: refreshed.scope,
      };
      config.auth = updated;
      oauthAuth = updated;
      setOAuthTokenForProvider('openai', {
        accessToken: updated.accessToken,
        refreshToken: updated.refreshToken,
        expiresAt: updated.expiresAt,
        tokenType: updated.tokenType,
        scope: updated.scope,
      });
      return updated;
    };

    const fetchWithOAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const active = await refreshOauthIfNeeded();
      const accessToken = active?.accessToken;
      const tokenPayload = accessToken ? decodeJwt(accessToken) : null;
      const accountId = typeof tokenPayload?.chatgpt_account_id === 'string'
        ? tokenPayload.chatgpt_account_id
        : undefined;

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) {
        const extra = new Headers(init.headers);
        extra.forEach((value, key) => headers.set(key, value));
      }
      headers.delete('authorization');
      headers.delete('Authorization');
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
      headers.set('OpenAI-Beta', 'responses=experimental');
      headers.set('originator', 'codex_cli_rs');
      if (accountId) headers.set('chatgpt-account-id', accountId);

      let url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
      const originalUrl = url;
      if (url.includes('/v1/responses')) {
        url = url.replace('/v1/responses', '/codex/responses');
      } else if (!url.includes('/codex/responses')) {
        url = url.replace('/responses', '/codex/responses');
      }

      let nextInit: RequestInit = {
        ...init,
        headers,
      };

      const method = (nextInit.method || (input instanceof Request ? input.method : 'GET')).toString().toUpperCase();
      if (method === 'POST') {
        const contentType = headers.get('content-type') ?? '';
        let bodyText: string | undefined;
        if (typeof nextInit.body === 'string') {
          bodyText = nextInit.body;
        } else if (nextInit.body instanceof Uint8Array) {
          bodyText = new TextDecoder().decode(nextInit.body);
        } else if (nextInit.body instanceof ArrayBuffer) {
          bodyText = new TextDecoder().decode(new Uint8Array(nextInit.body));
        }
        if (bodyText && (contentType.includes('application/json') || bodyText.trim().startsWith('{'))) {
          try {
            const json = JSON.parse(bodyText);
            let modified = false;
            if (json.store !== false) {
              json.store = false;
              modified = true;
            }
            if (config.systemPrompt && !json.instructions) {
              json.instructions = config.systemPrompt;
              modified = true;
            }
            if (json.max_output_tokens !== undefined) {
              delete json.max_output_tokens;
              modified = true;
            }
            if (json.max_tokens !== undefined) {
              delete json.max_tokens;
              modified = true;
            }
            if (modified) {
              nextInit = { ...nextInit, body: JSON.stringify(json) };
              headers.set('content-type', 'application/json');
            }
          } catch { }
        }
      }
      const bodySize = typeof nextInit.body === 'string' ? nextInit.body.length : 0;
      debugLog(`[oauth][openai] ${method} ${originalUrl} -> ${url} bodySize=${bodySize} token=${maskToken(accessToken)} account=${accountId ?? ''}`);
      const res = await fetch(url, nextInit);
      if (!res.ok) {
        const text = await res.clone().text();
        debugLog(`[oauth][openai] ${method} ${url} status=${res.status} body=${text.slice(0, 500)}`);
      }
      return res;
    };

    const openai = createOpenAI({
      apiKey: oauthAuth ? 'oauth' : cleanApiKey,
      baseURL: oauthAuth ? 'https://chatgpt.com/backend-api' : undefined,
      fetch: oauthAuth ? (fetchWithOAuth as typeof fetch) : undefined,
      compatibility: oauthAuth ? 'compatible' : undefined,
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

      const outputLimit = config.maxOutputTokens ?? 16384;
      const useOutputLimit = !oauthAuth;
      const result = streamText({
        model: pickModel(endpoint),
        messages: messages,
        system: config.systemPrompt,
        tools: toolsToUse,
        maxSteps: config.maxSteps ?? 100,
        ...(endpoint !== 'responses' && useOutputLimit ? { maxTokens: outputLimit } : {}),
        maxRetries: 0,
        abortSignal: options?.abortSignal,
        providerOptions: {
          openai: {
            strictJsonSchema,
            ...(openaiReasoning ?? {}),
            ...(endpoint === 'responses' && useOutputLimit ? { maxOutputTokens: outputLimit } : {}),
          },
        },
      });

      let stepCounter = 0;
      let hasEmitted = false;
      const sanitizer = new StreamSanitizer();
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
            yield {
              type: 'tool-result',
              toolCallId: String(c.toolCallId ?? ''),
              toolName: String(c.toolName ?? ''),
              result: c.result,
            };
            break;

          case 'finish': {
            hasEmitted = true;
            const finishReason = String(c.finishReason ?? 'stop');
            const effectiveFinishReason = finishReason === 'stop' && sanitizer.wasTruncated()
              ? 'length'
              : finishReason;
            if (effectiveFinishReason !== finishReason) {
              debugLog('[openai] finish reason remapped stop->length due to sanitizer truncation');
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
        { abortSignal: options?.abortSignal, key: config.provider }
      );
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      const msg = error instanceof Error ? error.message : String(error);

      if (oauthAuth) {
        yield {
          type: 'error',
          error: msg || 'Unknown error occurred',
        };
        return;
      }

      const fallbackEndpoint = classifyEndpointError(msg);
      if (fallbackEndpoint && fallbackEndpoint !== 'responses') {
        try {
          yield* runWithRetry(
            () => runOnce(fallbackEndpoint, false),
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
