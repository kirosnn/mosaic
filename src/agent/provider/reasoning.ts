import { findModelsDevModelById, getModelsDevModel } from '../../utils/models';

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

export type ReasoningDecision = {
  enabled: boolean;
  source: 'models.dev:direct' | 'models.dev:byId' | 'heuristic' | 'default';
};

/**
 * Determines if a model should have reasoning enabled (output display).
 * Uses models.dev metadata primarily, with a safe fallback heuristic.
 */
export async function getReasoningDecision(providerId: string, modelId: string): Promise<ReasoningDecision> {
  let provider = normalizeId(providerId);
  const model = normalizeId(modelId);

  if (provider.endsWith('-oauth')) {
    provider = provider.slice(0, -6);
  }

  // 1. models.dev direct lookup
  try {
    const direct = await getModelsDevModel(provider, modelId);
    if (direct && typeof direct.reasoning === 'boolean') {
      return { enabled: direct.reasoning, source: 'models.dev:direct' };
    }
  } catch {
  }

  // 2. models.dev byId lookup (useful for OpenRouter where modelId might be generic or prefixed)
  try {
    const byId = await findModelsDevModelById(modelId);
    if (byId?.model && typeof byId.model.reasoning === 'boolean') {
      return { enabled: byId.model.reasoning, source: 'models.dev:byId' };
    }
  } catch {
  }

  // 3. Heuristic Fallback
  if (isReasoningCapableHeuristic(provider, model)) {
    return { enabled: true, source: 'heuristic' };
  }

  return { enabled: false, source: 'default' };
}

/**
 * Split check: Can this model emit reasoning that we should display?
 */
export async function supportsReasoningOutput(providerId: string, modelId: string): Promise<boolean> {
  const decision = await getReasoningDecision(providerId, modelId);
  return decision.enabled;
}

/**
 * Split check: Does this model support configurable reasoning effort?
 * This is more strict than output support.
 */
export async function supportsReasoningEffort(providerId: string, modelId: string): Promise<boolean> {
  let provider = normalizeId(providerId);
  const model = normalizeId(modelId);

  if (provider.endsWith('-oauth')) {
    provider = provider.slice(0, -6);
  }

  // Effort is currently supported by:
  // - OpenAI (o1, o3-mini)
  // - xAI (grok-3)
  // - Anthropic (claude-3-7-sonnet)
  // - OpenRouter (if it proxies one of the above)

  // Use models.dev as primary source if available
  try {
    const direct = await getModelsDevModel(provider, modelId);
    // If models.dev says it has reasoning, we check if it's one of the known effort-capable families
    if (direct && direct.reasoning === true) {
      if (isEffortCapableFamily(direct.family || '', model)) {
        return true;
      }
    }
  } catch {}

  // Heuristic for effort
  return isEffortCapableHeuristic(provider, model);
}

function isReasoningCapableHeuristic(provider: string, model: string): boolean {
  const m = model.toLowerCase();

  // Common reasoning model families/patterns
  if (m.includes('o1-') || m === 'o1') return true;
  if (m.includes('o3-') || m === 'o3') return true;
  if (m.includes('deepseek-r1')) return true;
  if (m.includes('grok-3')) return true;
  if (m.includes('claude-3-7-sonnet')) return true;
  if (m.includes('thinking')) return true;
  if (m.includes('reasoning')) return true;

  // Google Thinking models
  if (provider === 'google' && m.includes('thinking')) return true;

  return false;
}

function isEffortCapableFamily(family: string, model: string): boolean {
  const f = family.toLowerCase();
  const m = model.toLowerCase();

  if (f === 'o1' || f === 'o3') return true;
  if (f === 'grok-3') return true;
  if (f === 'claude-3-7') return true;

  // Fallback check on model name if family is generic
  if (m.startsWith('o1') || m.startsWith('o3')) return true;
  if (m.includes('grok-3')) return true;
  if (m.includes('claude-3-7')) return true;

  return false;
}

function isEffortCapableHeuristic(provider: string, model: string): boolean {
  const m = model.toLowerCase();

  // OpenAI
  if ((provider === 'openai' || provider === 'openrouter') && (m.includes('o1') || m.includes('o3'))) {
    return true;
  }

  // xAI
  if ((provider === 'xai' || provider === 'openrouter') && m.includes('grok-3')) {
    return true;
  }

  // Anthropic
  if ((provider === 'anthropic' || provider === 'openrouter') && m.includes('claude-3-7')) {
    return true;
  }

  return false;
}

// Deprecated alias for backward compatibility if needed, but we should update callers
export async function shouldEnableReasoning(providerId: string, modelId: string): Promise<boolean> {
  return supportsReasoningOutput(providerId, modelId);
}
