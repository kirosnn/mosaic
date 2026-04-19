import {
  extractReasoningMiddleware,
  type LanguageModel,
  wrapLanguageModel,
} from "ai";
import { supportsReasoningOutput, supportsReasoningEffort } from "./reasoning";
import { debugLog } from "../../utils/debug";
import type { ReasoningEffort } from "../../utils/config";

export type ReasoningDecision = {
  enabled: boolean;
};

export async function resolveReasoningEnabled(
  providerId: string,
  modelId: string,
): Promise<ReasoningDecision> {
  const enabled = await supportsReasoningOutput(providerId, modelId);
  debugLog(
    `[reasoning] output_support provider=${providerId} model=${modelId} enabled=${enabled}`,
  );
  return { enabled };
}

export async function resolveReasoningEffortSupported(
  providerId: string,
  modelId: string,
): Promise<boolean> {
  const supported = await supportsReasoningEffort(providerId, modelId);
  debugLog(
    `[reasoning] effort_support provider=${providerId} model=${modelId} supported=${supported}`,
  );
  return supported;
}

function resolveReasoningEffort(effort?: ReasoningEffort): ReasoningEffort {
  return effort ?? "medium";
}

function getAnthropicBudgetTokens(effort: ReasoningEffort): number {
  switch (effort) {
    case "low":
      return 1024;
    case "medium":
      return 4000;
    case "high":
      return 12000;
    case "xhigh":
      return 24000;
  }
}

export async function getOpenAIReasoningOptions(
  providerId: string,
  modelId: string,
  outputEnabled: boolean,
  effort?: ReasoningEffort,
): Promise<{ reasoningEffort: ReasoningEffort } | undefined> {
  if (!outputEnabled) return undefined;

  const effortSupported = await supportsReasoningEffort(providerId, modelId);
  if (!effortSupported) return undefined;

  const resolved = resolveReasoningEffort(effort);
  debugLog(`[reasoning][openai] reasoningEffort=${resolved}`);
  return { reasoningEffort: resolved };
}

export async function getXaiReasoningOptions(
  providerId: string,
  modelId: string,
  outputEnabled: boolean,
  effort?: ReasoningEffort,
): Promise<{ reasoningEffort: ReasoningEffort } | undefined> {
  if (!outputEnabled) return undefined;

  const effortSupported = await supportsReasoningEffort(providerId, modelId);
  if (!effortSupported) return undefined;

  const resolved = resolveReasoningEffort(effort);
  debugLog(`[reasoning][xai] reasoningEffort=${resolved}`);
  return { reasoningEffort: resolved };
}

export function getGoogleReasoningOptions(
  enabled: boolean,
): { thinkingConfig: { includeThoughts: boolean } } | undefined {
  if (!enabled) return undefined;
  debugLog("[reasoning][google] thinkingConfig.includeThoughts=true");
  return {
    thinkingConfig: {
      includeThoughts: true,
    },
  };
}

export async function getAnthropicReasoningOptions(
  providerId: string,
  modelId: string,
  outputEnabled: boolean,
  effort?: ReasoningEffort,
): Promise<
  { thinking: { type: "enabled"; budgetTokens: number } } | undefined
> {
  if (!outputEnabled) return undefined;

  const resolved = resolveReasoningEffort(effort);
  const budgetTokens = getAnthropicBudgetTokens(resolved);
  debugLog(
    `[reasoning][anthropic] thinking=enabled budgetTokens=${budgetTokens} effort=${resolved}`,
  );
  return {
    thinking: {
      type: "enabled",
      budgetTokens,
    },
  };
}

export function applyMistralReasoning(
  baseModel: LanguageModel,
  systemPrompt: string,
  enabled: boolean,
): { model: LanguageModel; systemPrompt: string } {
  if (!enabled) {
    debugLog("[reasoning][mistral] disabled");
    return { model: baseModel, systemPrompt };
  }

  const model = wrapLanguageModel({
    model: baseModel,
    middleware: extractReasoningMiddleware({ tagName: "reasoning" }),
  });

  const reasoningInstruction =
    "When reasoning is enabled, wrap your reasoning in <reasoning>...</reasoning> and then provide the final answer.";
  const nextPrompt = systemPrompt
    ? `${systemPrompt}\n\n${reasoningInstruction}`
    : reasoningInstruction;
  debugLog(`[reasoning][mistral] enabled promptLen=${nextPrompt.length}`);

  return { model, systemPrompt: nextPrompt };
}

export function getOllamaThinkFlag(enabled: boolean): boolean {
  debugLog(`[reasoning][ollama] think=${enabled}`);
  return enabled;
}
