import { findModelsDevModelById, getModelsDevModel } from "../../utils/models";

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

export type ReasoningDecision = {
  enabled: boolean;
  source: "models.dev:direct" | "models.dev:byId" | "heuristic" | "default";
};

export async function getReasoningDecision(
  providerId: string,
  modelId: string,
): Promise<ReasoningDecision> {
  let provider = normalizeId(providerId);
  const model = normalizeId(modelId);

  if (provider.endsWith("-oauth")) {
    provider = provider.slice(0, -6);
  }

  try {
    const direct = await getModelsDevModel(provider, modelId);
    if (direct && typeof direct.reasoning === "boolean") {
      return { enabled: direct.reasoning, source: "models.dev:direct" };
    }
  } catch {}

  try {
    const byId = await findModelsDevModelById(modelId);
    if (byId?.model && typeof byId.model.reasoning === "boolean") {
      return { enabled: byId.model.reasoning, source: "models.dev:byId" };
    }
  } catch {}

  if (isReasoningCapableHeuristic(provider, model)) {
    return { enabled: true, source: "heuristic" };
  }

  return { enabled: false, source: "default" };
}

export async function supportsReasoningOutput(
  providerId: string,
  modelId: string,
): Promise<boolean> {
  const decision = await getReasoningDecision(providerId, modelId);
  return decision.enabled;
}

export async function supportsReasoningEffort(
  providerId: string,
  modelId: string,
): Promise<boolean> {
  let provider = normalizeId(providerId);
  const model = normalizeId(modelId);

  if (provider.endsWith("-oauth")) {
    provider = provider.slice(0, -6);
  }

  try {
    const direct = await getModelsDevModel(provider, modelId);
    if (direct && direct.reasoning === true) {
      if (isEffortCapableFamily(direct.family || "", model)) {
        return true;
      }
    }
  } catch {}

  return isEffortCapableHeuristic(provider, model);
}

function isReasoningCapableHeuristic(provider: string, model: string): boolean {
  const m = model.toLowerCase();

  if (m.includes("o1-") || m === "o1") return true;
  if (m.includes("o3-") || m === "o3") return true;
  if (m.includes("deepseek-r1")) return true;
  if (m.includes("grok-3")) return true;
  if (m.includes("claude-3-7-sonnet")) return true;
  if (m.includes("thinking")) return true;
  if (m.includes("reasoning")) return true;

  if (provider === "google" && m.includes("thinking")) return true;

  return false;
}

function isEffortCapableFamily(family: string, model: string): boolean {
  const f = family.toLowerCase();
  const m = model.toLowerCase();

  if (f === "o1" || f === "o3") return true;
  if (f === "grok-3") return true;
  if (f === "claude-3-7") return true;

  if (m.startsWith("o1") || m.startsWith("o3")) return true;
  if (m.includes("grok-3")) return true;
  if (m.includes("claude-3-7")) return true;

  return false;
}

function isEffortCapableHeuristic(provider: string, model: string): boolean {
  const m = model.toLowerCase();

  if (
    (provider === "openai" || provider === "openrouter") &&
    (m.includes("o1") || m.includes("o3"))
  ) {
    return true;
  }

  if (
    (provider === "xai" || provider === "openrouter") &&
    m.includes("grok-3")
  ) {
    return true;
  }

  if (
    (provider === "anthropic" || provider === "openrouter") &&
    m.includes("claude-3-7")
  ) {
    return true;
  }

  return false;
}

export async function shouldEnableReasoning(
  providerId: string,
  modelId: string,
): Promise<boolean> {
  return supportsReasoningOutput(providerId, modelId);
}
