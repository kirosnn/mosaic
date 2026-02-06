import { streamText, CoreMessage } from 'ai';
import { createXai } from '@ai-sdk/xai';
import { AgentEvent, Provider, ProviderConfig, ProviderSendOptions } from '../types';
import { getXaiReasoningOptions, resolveReasoningEnabled } from './reasoningConfig';
import { getRetryDecision, normalizeError, runWithRetry } from './rateLimit';
import { debugLog } from '../../utils/debug';

export class XaiProvider implements Provider {
  async *sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent> {
    const cleanApiKey = config.apiKey?.trim().replace(/[\r\n]+/g, '');
    const cleanModel = config.model.trim().replace(/[\r\n]+/g, '');
    const { enabled: reasoningEnabled } = await resolveReasoningEnabled(config.provider, cleanModel);
    const xaiReasoning = getXaiReasoningOptions(reasoningEnabled);
    debugLog(`[xai] starting stream model=${cleanModel} messagesLen=${messages.length} reasoning=${reasoningEnabled}`);

    const xai = createXai({
      apiKey: cleanApiKey,
    });

    try {
      let stepCounter = 0;

      yield* runWithRetry(async function* () {
        const result = streamText({
          model: xai(cleanModel),
          messages: messages,
          system: config.systemPrompt,
          tools: config.tools,
          maxSteps: config.maxSteps || 100,
          maxRetries: 0,
          abortSignal: options?.abortSignal,
          providerOptions: xaiReasoning ? { xai: xaiReasoning } : undefined,
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
      }, { abortSignal: options?.abortSignal, key: config.provider });
    } catch (error) {
      if (options?.abortSignal?.aborted) return;
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
