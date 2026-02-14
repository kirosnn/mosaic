export const SUITE_WEIGHTS: Record<string, number> = {
  "tool-use": 20,
  reasoning: 20,
  "code-reading": 15,
  resilience: 15,
  protocol: 15,
  safety: 15,
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
