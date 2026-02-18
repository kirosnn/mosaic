import type { Rule, SourceFile, ProjectInfo, RuleViolation } from '../types.js';
import { securityRules } from './security.js';
import { correctnessRules } from './correctness.js';
import { architectureRules } from './architecture.js';
import { performanceRules } from './performance.js';
import { stateEffectsRules } from './stateEffects.js';
import { nextjsRules } from './nextjs.js';
import { clientRules } from './client.js';
import { serverRules } from './server.js';
import { bundleSizeRules } from './bundleSize.js';
import { jsPerformanceRules } from './jsPerformance.js';
import { reactNativeRules } from './reactNative.js';
import { bugsRules } from './bugs.js';

export const ALL_RULES: Rule[] = [
  ...bugsRules,
  ...securityRules,
  ...correctnessRules,
  ...architectureRules,
  ...performanceRules,
  ...stateEffectsRules,
  ...nextjsRules,
  ...clientRules,
  ...serverRules,
  ...bundleSizeRules,
  ...jsPerformanceRules,
  ...reactNativeRules,
];

export function getRulesForFile(file: SourceFile, projectInfo: ProjectInfo): Rule[] {
  return ALL_RULES.filter(rule => {
    if (rule.jsxOnly && !file.isJsx) return false;
    if (rule.skipTests && file.isTest) return false;
    if (rule.frameworks && !rule.frameworks.includes(projectInfo.framework)) return false;
    return true;
  });
}

export function applyRules(
  file: SourceFile,
  projectInfo: ProjectInfo,
  categories?: string[],
): Array<RuleViolation & { rule: string; severity: 'error' | 'warning'; category: string }> {
  const rules = getRulesForFile(file, projectInfo).filter(
    r => !categories || categories.includes(r.category),
  );

  const results: Array<RuleViolation & { rule: string; severity: 'error' | 'warning'; category: string }> = [];

  for (const rule of rules) {
    try {
      const violations = rule.check(file, projectInfo);
      for (const v of violations) {
        results.push({ ...v, rule: rule.id, severity: rule.severity, category: rule.category });
      }
    } catch {
      // rule failures must not crash the scan
    }
  }

  return results;
}

export const AVAILABLE_CATEGORIES = [
  'bugs',
  'security',
  'correctness',
  'architecture',
  'performance',
  'state-effects',
  'nextjs',
  'client',
  'server',
  'bundle-size',
  'js-performance',
  'react-native',
  'project',
];
