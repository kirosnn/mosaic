import { extractReasoningMiddleware, type LanguageModel, wrapLanguageModel } from 'ai';
import { getReasoningDecision } from './reasoning';
import { debugLog } from '../../utils/debug';
import type { ReasoningEffort } from '../../utils/config';

export type ReasoningDecision = {
  enabled: boolean;
};

export async function resolveReasoningEnabled(providerId: string, modelId: string): Promise<ReasoningDecision> {
  const decision = await getReasoningDecision(providerId, modelId);
  debugLog(`[reasoning] decision provider=${providerId} model=${modelId} enabled=${decision.enabled} source=${decision.source}`);
  return { enabled: decision.enabled };
}

function resolveReasoningEffort(effort?: ReasoningEffort): ReasoningEffort {
  return effort ?? 'medium';
}

function getAnthropicBudgetTokens(effort: ReasoningEffort): number {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 4000;
    case 'high':
      return 12000;
    case 'xhigh':
      return 24000;
  }
}

export function getOpenAIReasoningOptions(enabled: boolean, effort?: ReasoningEffort): { reasoningEffort: ReasoningEffort } | undefined {
  if (!enabled) return undefined;
  const resolved = resolveReasoningEffort(effort);
  debugLog(`[reasoning][openai] reasoningEffort=${resolved}`);
  return { reasoningEffort: resolved };
}

export function getXaiReasoningOptions(enabled: boolean, effort?: ReasoningEffort): { reasoningEffort: ReasoningEffort } | undefined {
  if (!enabled) return undefined;
  const resolved = resolveReasoningEffort(effort);
  debugLog(`[reasoning][xai] reasoningEffort=${resolved}`);
  return { reasoningEffort: resolved };
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

export function getAnthropicReasoningOptions(enabled: boolean, effort?: ReasoningEffort): { thinking: { type: 'enabled'; budgetTokens: number } } | undefined {
  if (!enabled) return undefined;
  const resolved = resolveReasoningEffort(effort);
  const budgetTokens = getAnthropicBudgetTokens(resolved);
  debugLog(`[reasoning][anthropic] thinking=enabled budgetTokens=${budgetTokens} effort=${resolved}`);
  return {
    thinking: {
      type: 'enabled',
      budgetTokens,
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
