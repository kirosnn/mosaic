import { streamText, CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { getAnthropicReasoningOptions, resolveReasoningEnabled } from './reasoningConfig';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';
import { debugLog } from '../../utils/debug';
import { StreamSanitizer } from './streamSanitizer';

export class AnthropicProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(config.provider, cleanModel);
    const anthropicReasoning = getAnthropicReasoningOptions(reasoningEnabled);

    const anthropic = createAnthropic({
      apiKey: cleanApiKey,
    });
    debugLog(`[anthropic] starting stream model=${cleanModel} messagesLen=${messages.length} reasoning=${reasoningEnabled}`);
    try {
      let stepCounter = 0;

      yield* runWithRetry(async function* () {
        const result = streamText({
          model: anthropic(cleanModel),
          messages: messages,
          system: config.systemPrompt,
          tools: config.tools,
          maxSteps: config.maxSteps || 100,
          maxTokens: config.maxOutputTokens ?? 16384,
          maxRetries: 0,
          abortSignal: options?.abortSignal,
          providerOptions: anthropicReasoning ? { anthropic: anthropicReasoning } : undefined,
        });

        const sanitizer = new StreamSanitizer();

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

            case 'text-delta': {
              const safe = sanitizer.feed(c.textDelta);
              if (safe !== null) {
                yield { type: 'text-delta', content: safe };
              }
              break;
            }

            case 'step-start':
              sanitizer.reset();
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
              debugLog(`[anthropic] tool-call ${c.toolName} args=${JSON.stringify(c.args ?? {}).slice(0, 100)}`);
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

            case 'finish': {
              const finishReason = String(c.finishReason ?? 'stop');
              const effectiveFinishReason = finishReason === 'stop' && sanitizer.wasTruncated()
                ? 'length'
                : finishReason;
              if (effectiveFinishReason !== finishReason) {
                debugLog('[anthropic] finish reason remapped stop->length due to sanitizer truncation');
              }
              debugLog(`[anthropic] finish reason=${effectiveFinishReason} promptTokens=${c.usage?.promptTokens ?? '?'} completionTokens=${c.usage?.completionTokens ?? '?'}`);
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
      }, { abortSignal: options?.abortSignal, key: config.provider });
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      debugLog(`[anthropic] ERROR ${errorMsg.slice(0, 200)}`);
      yield {
        type: 'error',
        error: errorMsg,
      };
    }
  }
}
