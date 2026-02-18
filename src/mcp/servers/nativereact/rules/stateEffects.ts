import type { Rule, RuleViolation } from '../types.js';
import { scanContent, scanLines, countOccurrences, indexToLineCol } from './utils.js';

const CASCADING_SET_STATE_THRESHOLD = 3;
const RELATED_USE_STATE_THRESHOLD = 5;

export const stateEffectsRules: Rule[] = [
  {
    id: 'noFetchInEffect',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{0,800}?\bfetch\s*\(/,
        'fetch() inside useEffect causes race conditions and missing cleanup',
        'Use React Query, SWR, or server components for data fetching instead of useEffect + fetch.',
      );
    },
  },
  {
    id: 'noDerivedStateEffect',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*set[A-Z]\w*\s*\([^)]*\)\s*;\s*\}\s*,\s*\[[^\]]*\w[^\]]*\]\s*\)/,
        'useEffect that only sets state from a dependency is a derived state anti-pattern',
        'Derive the value during rendering instead: const derived = computeFrom(prop). No effect needed.',
      );
    },
  },
  {
    id: 'noCascadingSetState',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const effectPattern = /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{([\s\S]{0,1500}?)\}\s*,\s*\[/g;
      let m: RegExpExecArray | null;
      const re = new RegExp(effectPattern.source, 'g');
      while ((m = re.exec(file.content)) !== null) {
        const body = m[1];
        if (!body) continue;
        const setStateCount = (body.match(/\bset[A-Z]\w*\s*\(/g) || []).length;
        if (setStateCount >= CASCADING_SET_STATE_THRESHOLD) {
          const pos = indexToLineCol(file.content, m.index);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `${setStateCount} setState calls in a single useEffect`,
            help: 'Multiple setState calls in one effect cause cascading renders. Use useReducer to update all state atomically.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'noEffectEventHandler',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{0,400}?\.addEventListener\s*\(\s*['"`]\w+['"`]/,
        'useEffect simulating an event handler is an anti-pattern',
        'Add event listeners directly on elements (onClick, onChange) or use the ref pattern. Reserve useEffect for synchronization with external systems.',
      );
    },
  },
  {
    id: 'noDerivedUseState',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /useState\s*\(\s*props\.\w+\s*\)|useState\s*\(\s*\w+\.\w+\s*\)(?!\s*\/\/\s*initial)/,
        'useState initialized from a prop loses sync when the prop changes',
        'If the value should update when the prop changes, derive it during rendering. If it truly needs to be independent, document why.',
      );
    },
  },
  {
    id: 'preferUseReducer',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const count = countOccurrences(file.content, /\buseState\s*\(/);
      if (count >= RELATED_USE_STATE_THRESHOLD) {
        violations.push({
          line: 1,
          column: 1,
          message: `${count} useState calls in one file`,
          help: `When you have ${RELATED_USE_STATE_THRESHOLD}+ related state variables, consider useReducer for clearer state transitions and atomic updates.`,
        });
      }
      return violations;
    },
  },
  {
    id: 'rerenderLazyStateInit',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /useState\s*\(\s*\w+(?:\.\w+)*\s*\(\s*(?:[^)]*)\s*\)\s*\)/,
        'Function called directly in useState initializer runs on every render',
        'Pass the function reference to useState as an initializer: useState(computeValue) instead of useState(computeValue()).',
      );
    },
  },
  {
    id: 'rerenderFunctionalSetstate',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /set([A-Z]\w*)\s*\(\s*\1\s*(?:\+|-|\*|\/)\s*\d+\s*\)/i,
        m => `set${m[1]}(${m[1]} ± n) reads potentially stale state`,
        'Use functional update form: setState(prev => prev + 1) to always operate on the latest value.',
      );
    },
  },
  {
    id: 'rerenderDependencies',
    category: 'state-effects',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /(?:useEffect|useMemo|useCallback)\s*\(\s*[^,]+,\s*\[\s*(?:\{[^}]*\}|\[[^\]]*\])\s*\]/,
        'Object or array literal in dependency array creates a new reference on every render',
        'Move the value outside the component, wrap it in useMemo, or extract the primitive values you actually need.',
      );
    },
  },
];
