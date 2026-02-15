import { extractReasoningMiddleware, type LanguageModel, wrapLanguageModel } from 'ai';
import { getReasoningDecision } from './reasoning';
import { debugLog } from '../../utils/debug';

export type ReasoningDecision = {
  enabled: boolean;
};

export async function resolveReasoningEnabled(providerId: string, modelId: string): Promise<ReasoningDecision> {
  const decision = await getReasoningDecision(providerId, modelId);
  debugLog(`[reasoning] decision provider=${providerId} model=${modelId} enabled=${decision.enabled} source=${decision.source}`);
  return { enabled: decision.enabled };
}

export function getOpenAIReasoningOptions(enabled: boolean): { reasoningEffort: 'high' } | undefined {
  if (!enabled) return undefined;
  debugLog('[reasoning][openai] reasoningEffort=high');
  return { reasoningEffort: 'high' };
}

export function getXaiReasoningOptions(enabled: boolean): { reasoningEffort: 'high' } | undefined {
  if (!enabled) return undefined;
  debugLog('[reasoning][xai] reasoningEffort=high');
  return { reasoningEffort: 'high' };
}

export function getGoogleReasoningOptions(enabled: boolean): { thinkingConfig: { includeThoughts: false } } | undefined {
  if (!enabled) return undefined;
  debugLog('[reasoning][google] thinkingConfig.includeThoughts=false');
  return {
    thinkingConfig: {
      includeThoughts: false,
    },
  };
}

export function getAnthropicReasoningOptions(enabled: boolean): { thinking: { type: 'enabled'; budgetTokens: number } } | undefined {
  if (!enabled) return undefined;
  debugLog('[reasoning][anthropic] thinking=enabled budgetTokens=10000');
  return {
    thinking: {
      type: 'enabled',
      budgetTokens: 10000,
    },
  };
}

export function applyMistralReasoning(
  baseModel: LanguageModel,
  systemPrompt: string,
  enabled: boolean
): { model: LanguageModel; systemPrompt: string } {
  if (!enabled) {
    debugLog('[reasoning][mistral] disabled');
    return { model: baseModel, systemPrompt };
  }

  const model = wrapLanguageModel({
    model: baseModel,
    middleware: extractReasoningMiddleware({ tagName: 'reasoning' }),
  });

  const reasoningInstruction =
    'When reasoning is enabled, wrap your reasoning in <reasoning>...</reasoning> and then provide the final answer.';
  const nextPrompt = systemPrompt ? `${systemPrompt}\n\n${reasoningInstruction}` : reasoningInstruction;
  debugLog(`[reasoning][mistral] enabled promptLen=${nextPrompt.length}`);

  return { model, systemPrompt: nextPrompt };
}

export function getOllamaThinkFlag(enabled: boolean): boolean {
  debugLog(`[reasoning][ollama] think=${enabled}`);
  return enabled;
}
