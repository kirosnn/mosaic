import type { Rule, RuleViolation } from '../types.js';
import { scanContent, scanLines, indexToLineCol } from './utils.js';

const SEQUENTIAL_AWAIT_THRESHOLD = 3;
const DEEP_NESTING_THRESHOLD = 3;
const DUPLICATE_STORAGE_READ_THRESHOLD = 2;

export const jsPerformanceRules: Rule[] = [
  {
    id: 'jsCombineIterations',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /\.\s*(?:filter|map|forEach|reduce)\s*\([^)]+\)\s*\.\s*(?:filter|map|forEach|reduce)\s*\(/,
        'Chained array iterations (map, filter, etc.) traverse the array multiple times',
        'Combine into a single reduce() or for loop to traverse the array once.',
      );
    },
  },
  {
    id: 'jsTosortedImmutable',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /\[\s*\.\.\.\s*\w+\s*\]\s*\.sort\s*\(|\w+\.slice\s*\(\s*\)\s*\.sort\s*\(/,
        'Spread + sort copies the array unnecessarily',
        'Use .toSorted() (ES2023) for an immutable sort without copying: arr.toSorted(compareFn).',
      );
    },
  },
  {
    id: 'jsHoistRegexp',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /(?:for|while|\.(?:map|filter|forEach|reduce|find|some|every))\s*\([^{]*\{[^}]*new\s+RegExp\s*\(/,
        'new RegExp() inside a loop creates a new regex object on every iteration',
        'Hoist the RegExp to a constant outside the loop: const re = /pattern/g; then use re inside the loop.',
      );
    },
  },
  {
    id: 'jsMinMaxLoop',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /\.sort\s*\(\s*(?:\([^)]*\)\s*=>|function\s*\([^)]*\))[^}]*\}\s*\)\s*\[\s*(?:0|-1)\s*\]/,
        'Sorting to find min/max is O(n log n) when Math.min/max is O(n)',
        'Use Math.min(...arr) or Math.max(...arr), or reduce() for arrays: arr.reduce((a, b) => Math.max(a, b)).',
      );
    },
  },
  {
    id: 'jsSetMapLookups',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /(?:for|while|\.(?:map|filter|forEach|reduce|find))\s*\([^{]*\{[^}]*\.includes\s*\(/,
        'Array .includes() inside a loop is O(n²) overall',
        'Build a Set from the array first, then use Set.has() for O(1) lookups: const set = new Set(arr).',
      );
    },
  },
  {
    id: 'jsBatchDomCss',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const stylePattern = /(\w+)\.style\.(\w+)\s*=/g;
      const seen = new Map<string, number[]>();
      let m: RegExpExecArray | null;
      while ((m = stylePattern.exec(file.content)) !== null) {
        const el = m[1];
        if (!el) continue;
        const positions = seen.get(el) || [];
        positions.push(m.index);
        seen.set(el, positions);
      }
      for (const [el, positions] of seen) {
        if (positions.length >= 3) {
          const firstPos = positions[0] ?? 0;
          const pos = indexToLineCol(file.content, firstPos);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `${positions.length} sequential style assignments on "${el}"`,
            help: 'Batch style changes with element.style.cssText = "..." or toggle a CSS class to avoid multiple style recalculations.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'jsIndexMaps',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /(?:for|while|\.(?:map|filter|forEach|reduce))\s*\([^{]*\{[^}]*\.find\s*\(/,
        'Array .find() inside a loop is O(n²) overall',
        'Build a Map keyed by the lookup property before the loop, then use map.get() for O(1) access.',
      );
    },
  },
  {
    id: 'jsCacheStorage',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const storagePattern = /(?:localStorage|sessionStorage)\.getItem\s*\(\s*(['"`][^'"`]+['"`])\s*\)/g;
      const counts = new Map<string, { count: number; firstIndex: number }>();
      let m: RegExpExecArray | null;
      while ((m = storagePattern.exec(file.content)) !== null) {
        const key = m[1];
        if (!key) continue;
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { count: 1, firstIndex: m.index });
        }
      }
      for (const [key, { count, firstIndex }] of counts) {
        if (count >= DUPLICATE_STORAGE_READ_THRESHOLD) {
          const pos = indexToLineCol(file.content, firstIndex);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `localStorage.getItem(${key}) called ${count} times`,
            help: 'Cache the result in a variable: const value = localStorage.getItem(key); and reuse it.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'jsEarlyExit',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i] ?? '';
        const depth = (line.match(/^\s*/)?.[0].length ?? 0) / 2;
        if (depth >= DEEP_NESTING_THRESHOLD && /\bif\s*\(/.test(line)) {
          violations.push({
            line: i + 1,
            column: Math.max(line.search(/\S/), 0) + 1,
            message: `Deeply nested if statement (depth ~${Math.floor(depth)})`,
            help: 'Use early returns/guards to reduce nesting: if (!condition) return; instead of if (condition) { ... }.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'asyncParallel',
    category: 'js-performance',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const lines = file.lines;
      for (let i = 0; i < lines.length - SEQUENTIAL_AWAIT_THRESHOLD; i++) {
        let count = 0;
        for (let j = i; j < Math.min(i + 6, lines.length); j++) {
          const jLine = lines[j] ?? '';
          if (/^\s*(?:const|let)\s+\w+\s*=\s*await\s+/.test(jLine)) {
            count++;
          } else if (jLine.trim() !== '' && !/^\s*\/\//.test(jLine)) {
            break;
          }
        }
        if (count >= SEQUENTIAL_AWAIT_THRESHOLD) {
          violations.push({
            line: i + 1,
            column: 1,
            message: `${count} sequential await calls that may be parallelizable`,
            help: 'If these promises are independent, use Promise.all([a(), b(), c()]) to run them in parallel.',
          });
          i += count - 1;
        }
      }
      return violations;
    },
  },
];
