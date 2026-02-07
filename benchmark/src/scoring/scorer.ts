import type { ScoringRule, TestContext, RuleResult, PerformanceMetrics, LatencyMetrics } from "../types.js";

export function computePerformance(latency: LatencyMetrics): PerformanceMetrics {
  const charsPerSecond = latency.streamDurationMs > 0
    ? Math.round((latency.totalChars / latency.streamDurationMs) * 1000)
    : 0;
  return {
    ttftMs: Math.round(latency.ttftMs),
    charsPerSecond,
  };
}

export function scoreTest(
  rules: ScoringRule[],
  ctx: TestContext,
): { score: number; maxScore: number; percentage: number; ruleResults: RuleResult[]; performance: PerformanceMetrics } {
  const ruleResults: RuleResult[] = [];
  let earned = 0;
  let maxScore = 0;
  let penalty = 0;

  for (const rule of rules) {
    const passed = rule.evaluate(ctx);
    let points = 0;

    if (passed) {
      points = rule.weight;
      earned += rule.weight;
    } else if (rule.isCritical) {
      points = -rule.weight;
      penalty += rule.weight;
    }

    maxScore += rule.weight;

    ruleResults.push({
      rule: rule.name,
      description: rule.description,
      passed,
      weight: rule.weight,
      isCritical: rule.isCritical,
      points,
    });
  }

  const raw = Math.max(0, earned - penalty);
  const percentage = maxScore > 0 ? Math.round((raw / maxScore) * 100) : 0;
  const performance = computePerformance(ctx.latency);

  return { score: raw, maxScore, percentage, ruleResults, performance };
}
