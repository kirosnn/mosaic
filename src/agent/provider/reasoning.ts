import { findModelsDevModelById, getModelsDevModel } from '../../utils/models';

function normalizeId(value: string): string {
  return value.trim();
}

function matchesReasoningHeuristic(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes('reasoning') || id.includes('o1') || id.includes('o3') || id.includes('r1') || id.includes('codex') || id.includes('gpt-5');
}

export async function shouldEnableReasoning(providerId: string, modelId: string): Promise<boolean> {
  const provider = normalizeId(providerId);
  const model = normalizeId(modelId);

  try {
    const direct = await getModelsDevModel(provider, model);
    if (direct && typeof direct.reasoning === 'boolean') return direct.reasoning;
  } catch {
  }

  try {
    const byId = await findModelsDevModelById(model);
    if (byId?.model && typeof byId.model.reasoning === 'boolean') return byId.model.reasoning;
  } catch {
  }

  return matchesReasoningHeuristic(model);
}
