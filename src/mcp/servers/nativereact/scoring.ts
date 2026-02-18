import type { Diagnostic } from './types.js';

const CATEGORY_WEIGHTS: Record<string, number> = {
  bugs: 2.0,
  security: 1.8,
  correctness: 1.5,
  'state-effects': 1.2,
  architecture: 1.0,
  performance: 1.0,
  nextjs: 1.0,
  client: 0.8,
  server: 1.2,
  'bundle-size': 0.8,
  'js-performance': 0.7,
  'react-native': 1.0,
  project: 1.4,
};

export function calculateScore(
  diagnostics: Diagnostic[],
  fileCount: number,
): { score: number; status: 'good' | 'ok' | 'poor' } {
  if (fileCount === 0) return { score: 100, status: 'good' };

  let weightedErrorPenalty = 0;
  let weightedWarningPenalty = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const d of diagnostics) {
    const weight = CATEGORY_WEIGHTS[d.category] ?? 1.0;
    if (d.severity === 'error') {
      weightedErrorPenalty += 2.5 * weight;
      errorCount++;
    } else {
      weightedWarningPenalty += 0.3 * weight;
      warningCount++;
    }
  }

  const weightedPenalty = weightedErrorPenalty + weightedWarningPenalty;
  const penaltyCap = Math.min(weightedPenalty, 80);
  const densityPenalty = Math.min((errorCount / fileCount) * 10 + (warningCount / fileCount) * 1.5, 20);

  const score = Math.max(0, Math.round(100 - penaltyCap - densityPenalty));

  let status: 'good' | 'ok' | 'poor';
  if (score >= 72) status = 'good';
  else if (score >= 40) status = 'ok';
  else status = 'poor';

  return { score, status };
}

export function buildCategoryBreakdown(diagnostics: Diagnostic[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const d of diagnostics) {
    breakdown[d.category] = (breakdown[d.category] ?? 0) + 1;
  }
  return breakdown;
}
