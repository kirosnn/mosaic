import { streamText, CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { shouldEnableReasoning } from './reasoning';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';
import { refreshAnthropicOAuthToken } from '../../auth/oauth';
import { setOAuthTokenForProvider } from '../../utils/config';
import { debugLog, maskToken } from '../../utils/debug';

export class AnthropicProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    const reasoningEnabled = await shouldEnableReasoning(config.provider, cleanModel);

    let oauthAuth = config.auth?.type === 'oauth' ? config.auth : undefined;

    const refreshOauthIfNeeded = async (): Promise<typeof oauthAuth> => {
      if (!oauthAuth?.refreshToken) return oauthAuth;
      if (oauthAuth.expiresAt && Date.now() < oauthAuth.expiresAt - 60000) return oauthAuth;
      const refreshed = await refreshAnthropicOAuthToken(oauthAuth.refreshToken);
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
      setOAuthTokenForProvider('anthropic', {
        accessToken: updated.accessToken,
        refreshToken: updated.refreshToken,
        expiresAt: updated.expiresAt,
        tokenType: updated.tokenType,
        scope: updated.scope,
      });
      return updated;
    };

    const fetchWithOAuth: typeof fetch = async (input, init) => {
      const active = await refreshOauthIfNeeded();
      const accessToken = active?.accessToken;

      const initHeaders: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value: string, key: string) => { initHeaders[key] = value; });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            if (typeof value !== 'undefined') initHeaders[key] = String(value);
          }
        } else {
          for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
            if (typeof value !== 'undefined') initHeaders[key] = String(value);
          }
        }
      }

      const headers: Record<string, string> = {
        ...initHeaders,
        'authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      };
      delete headers['x-api-key'];

      debugLog(`[oauth][anthropic] ${init?.method ?? 'GET'} ${typeof input === 'string' ? input : (input as any).url ?? input} token=${maskToken(accessToken)}`);
      const headerDump = Object.entries(headers).map(([k, v]) => `${k}: ${k === 'authorization' ? maskToken(v) : v}`).join(' | ');
      debugLog(`[oauth][anthropic] headers: ${headerDump}`);

      const response = await fetch(input, {
        ...init,
        headers,
      });

      if (!response.ok) {
        const text = await response.clone().text();
        debugLog(`[oauth][anthropic] status=${response.status} body=${text.slice(0, 500)}`);
      }

      return response;
    };

    const anthropic = createAnthropic({
      apiKey: oauthAuth ? 'oauth' : cleanApiKey,
      fetch: oauthAuth ? fetchWithOAuth : undefined,
    });

    try {
      let stepCounter = 0;

      yield* runWithRetry(async function* () {
        const result = streamText({
          model: anthropic(cleanModel),
          messages: messages,
          system: config.systemPrompt,
          tools: config.tools,
          maxSteps: config.maxSteps || 100,
          abortSignal: options?.abortSignal,
          experimental_providerMetadata: reasoningEnabled
            ? {
              anthropic: {
                thinkingBudgetTokens: 10000,
              },
            }
            : undefined,
        });

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
      }, { abortSignal: options?.abortSignal });
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
