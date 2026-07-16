export const SUITE_WEIGHTS: Record<string, number> = {
  "tool-use": 18,
  reasoning: 18,
  "code-reading": 14,
  resilience: 14,
  protocol: 14,
  safety: 14,
  "multi-turn": 8,
};

export function computeOverall(suiteScores: Record<string, number>): number {
  let total = 0;
  let weightSum = 0;

  for (const [suite, weight] of Object.entries(SUITE_WEIGHTS)) {
    const score = suiteScores[suite];
    if (score !== undefined) {
      total += score * weight;
      weightSum += weight;
    }
  }

  return weightSum > 0 ? Math.round(total / weightSum) : 0;
}
