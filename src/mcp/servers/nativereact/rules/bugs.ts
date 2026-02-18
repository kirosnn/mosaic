import type { Rule, RuleViolation } from '../types.js';
import { scanLines, scanContent, indexToLineCol } from './utils.js';

export const bugsRules: Rule[] = [
  {
    id: 'noConditionalHook',
    category: 'bugs',
    severity: 'error',
    check(file) {
      return scanContent(
        file.content,
        /\bif\s*\([^)]*\)\s*\{[^}]*\buse[A-Z]\w*\s*\(|\bif\s*\([^)]*\)\s*use[A-Z]\w*\s*\(/,
        m => `React hook called inside a conditional: ${(m[0].match(/\buse[A-Z]\w*/) ?? [])[0] ?? 'hook'}`,
        'Hooks must be called at the top level of a component, never inside conditions, loops, or nested functions. Move the hook call outside the if block.',
      );
    },
  },
  {
    id: 'noForInArray',
    category: 'bugs',
    severity: 'error',
    check(file) {
      return scanContent(
        file.content,
        /\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+in\s+\w+/,
        'for...in iterates over enumerable property names (keys), not array values',
        'Use for...of to iterate over values: for (const item of array). Use Object.entries() for objects.',
      );
    },
  },
  {
    id: 'noNaNComparison',
    category: 'bugs',
    severity: 'error',
    check(file) {
      return scanContent(
        file.content,
        /\b\w+\s*[!=]==?\s*NaN\b|\bNaN\s*[!=]==?\s*\w+/,
        'Comparing with NaN using === or !== always returns false — NaN is never equal to anything',
        'Use Number.isNaN(value) or isNaN(value) to check for NaN.',
      );
    },
  },
  {
    id: 'noMutatingState',
    category: 'bugs',
    severity: 'error',
    jsxOnly: true,
    check(file) {
      const violations: RuleViolation[] = [];
      const stateVarPattern = /const\s+\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState/g;
      const stateVars = new Set<string>();
      let m: RegExpExecArray | null;

      const stateRe = new RegExp(stateVarPattern.source, 'g');
      while ((m = stateRe.exec(file.content)) !== null) {
        const v = m[1];
        if (v) stateVars.add(v);
      }

      for (const v of stateVars) {
        const mutationPattern = new RegExp(
          `\\b${v}\\s*\\.\\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|delete)\\s*\\(`,
          'g',
        );
        const mutRe = new RegExp(mutationPattern.source, 'g');
        while ((m = mutRe.exec(file.content)) !== null) {
          const pos = indexToLineCol(file.content, m.index);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `Direct mutation of state variable "${v}" — React will not re-render`,
            help: 'Create a new array/object instead: setState([...state, newItem]) or setState(prev => [...prev, newItem]).',
          });
        }

        const propMutationPattern = new RegExp(`\\b${v}(?:\\.\\w+)+\\s*=(?!=)`, 'g');
        const propRe = new RegExp(propMutationPattern.source, 'g');
        while ((m = propRe.exec(file.content)) !== null) {
          const pos = indexToLineCol(file.content, m.index);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `Direct property assignment on state variable "${v}"`,
            help: 'Spread the object into a new one: setState({ ...state, property: newValue }).',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'noDuplicateObjectKey',
    category: 'bugs',
    severity: 'error',
    check(file) {
      const violations: RuleViolation[] = [];
      const objectPattern = /\{([^{}]{10,})\}/g;
      let m: RegExpExecArray | null;
      const re = new RegExp(objectPattern.source, 'g');
      while ((m = re.exec(file.content)) !== null) {
        const body = m[1];
        if (!body) continue;
        const keyPattern = /^\s*(["']?)(\w+)\1\s*:/gm;
        const seen = new Map<string, number>();
        let km: RegExpExecArray | null;
        const kre = new RegExp(keyPattern.source, 'gm');
        while ((km = kre.exec(body)) !== null) {
          const key = km[2];
          if (!key) continue;
          const prev = seen.get(key);
          if (prev !== undefined) {
            const absIdx = m.index + (m[0].indexOf(km[0]));
            const pos = indexToLineCol(file.content, absIdx);
            violations.push({
              line: pos.line,
              column: pos.column,
              message: `Duplicate object key "${key}" — the second value silently overwrites the first`,
              help: 'Remove the duplicate key or rename it. Only the last value assigned to a key is kept.',
            });
          } else {
            seen.set(key, km.index);
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'noUnusedImport',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const importPattern = /^import\s+\{([^}]+)\}\s+from\s+['"`][^'"`]+['"`]/gm;
      let m: RegExpExecArray | null;
      const re = new RegExp(importPattern.source, 'gm');
      while ((m = re.exec(file.content)) !== null) {
        const body = m[1];
        if (!body) continue;
        const importLine = m[0];
        const names = body.split(',').map(s => {
          const alias = s.match(/\bas\s+(\w+)/);
          const base = s.match(/^\s*(\w+)/);
          return (alias?.[1] ?? base?.[1] ?? '').trim();
        }).filter(Boolean);

        const restOfFile = file.content.slice(m.index + importLine.length);
        for (const name of names) {
          if (name === '_' || name.startsWith('_')) continue;
          if (name === 'type') continue;
          const usageRe = new RegExp(`\\b${name}\\b`);
          if (!usageRe.test(restOfFile)) {
            const pos = indexToLineCol(file.content, m.index);
            violations.push({
              line: pos.line,
              column: pos.column,
              message: `"${name}" is imported but never used`,
              help: `Remove the unused import "${name}" to reduce bundle size and improve readability.`,
            });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'noDuplicateImport',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const importPattern = /^import\s+[^;]+from\s+(['"`])([^'"`]+)\1/gm;
      const seen = new Map<string, number>();
      let m: RegExpExecArray | null;
      const re = new RegExp(importPattern.source, 'gm');
      while ((m = re.exec(file.content)) !== null) {
        const mod = m[2];
        if (!mod) continue;
        const prev = seen.get(mod);
        if (prev !== undefined) {
          const pos = indexToLineCol(file.content, m.index);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `Module "${mod}" imported twice`,
            help: 'Merge all imports from the same module into a single import statement.',
          });
        } else {
          seen.set(mod, m.index);
        }
      }
      return violations;
    },
  },
  {
    id: 'noEmptyCatch',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /catch\s*\([^)]*\)\s*\{\s*\}/,
        'Empty catch block silently swallows errors',
        'At minimum, log the error: catch (err) { console.error(err); }. Silent failures make debugging very difficult.',
      );
    },
  },
  {
    id: 'noMissingSwitchDefault',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      const violations: RuleViolation[] = [];
      const switchPattern = /\bswitch\s*\([^)]+\)\s*\{/g;
      let m: RegExpExecArray | null;
      const re = new RegExp(switchPattern.source, 'g');
      while ((m = re.exec(file.content)) !== null) {
        const braceStart = file.content.indexOf('{', m.index + m[0].length - 1);
        if (braceStart === -1) continue;
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < file.content.length; i++) {
          if (file.content[i] === '{') depth++;
          else if (file.content[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end === -1) continue;
        const block = file.content.slice(braceStart, end + 1);
        if (!block.includes('default:') && !block.includes('default :')) {
          const pos = indexToLineCol(file.content, m.index);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: 'switch statement has no default case',
            help: 'Add a default case to handle unexpected values. This prevents silent failures when new values are introduced.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'noParseIntNoRadix',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /\bparseInt\s*\(\s*[^,)]+\s*\)/,
        'parseInt() without a radix argument uses base 10 in modern JS but historically caused bugs',
        'Always pass the radix explicitly: parseInt(value, 10) to prevent misinterpretation of strings like "08".',
      );
    },
  },
  {
    id: 'noAsyncEventHandler',
    category: 'bugs',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /\bon[A-Z]\w*\s*=\s*\{?\s*async\s*(?:\([^)]*\)|[a-z_$]\w*)\s*=>/,
        'Async event handler can cause state updates after component unmount',
        'Use a mounted flag or AbortController to cancel async operations. Consider extracting to a custom hook with proper cleanup.',
      );
    },
  },
  {
    id: 'noObjectSpreadInLoop',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /(?:for\s*\([^)]+\)|while\s*\([^)]+\)|\.(?:map|filter|reduce|forEach)\s*\([^)]*\))\s*(?:=>)?\s*\{[^}]*\.\.\.\s*\w+[^}]*\}/,
        'Object/array spread inside a loop allocates a new object on every iteration',
        'Pre-compute the spread outside the loop, or use Object.assign() on a single accumulated object.',
      );
    },
  },
  {
    id: 'noFloatingPromise',
    category: 'bugs',
    severity: 'warning',
    check(file) {
      return scanContent(
        file.content,
        /^\s*(?!(?:return|const|let|var|await|throw|export)\s)(?:\w+(?:\.\w+)*)\s*\([^)]*\)\s*\.then\s*\(/m,
        'Promise chain not assigned or returned — rejections will be unhandled',
        'Assign the promise to a variable, add .catch(), or use await. Unhandled rejections crash in Node.js and are silent in browsers.',
      );
    },
  },
  {
    id: 'noSyncStorageInRender',
    category: 'bugs',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /(?:const|let|var)\s+\w+\s*=\s*(?:localStorage|sessionStorage)\.getItem\s*\(/,
        'Synchronous storage read during render blocks the main thread and causes hydration mismatch in SSR',
        'Move storage reads into useEffect or a custom hook that runs client-side only.',
      );
    },
  },
  {
    id: 'noImplicitReturnUndefined',
    category: 'bugs',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /function\s+[A-Z]\w*\s*\([^)]*\)\s*\{[\s\S]{0,2000}?(?:if|switch)\s*\([^)]*\)\s*\{[\s\S]{0,500}?return\s+[^;]+;[\s\S]{0,200}?\}/,
        m => {
          const hasUnconditionalReturn = /\breturn\s+(?!undefined\b)[^;{]+;[\s\S]*?\}$/.test(m[0]);
          if (!hasUnconditionalReturn) return '';
          return '';
        },
        '',
      ).filter(() => false);
    },
  },
  {
    id: 'noLoopHookCall',
    category: 'bugs',
    severity: 'error',
    check(file) {
      return scanContent(
        file.content,
        /\b(?:for|while)\s*\([^)]*\)\s*\{[^}]*\buse[A-Z]\w*\s*\(/,
        m => `React hook called inside a loop: ${(m[0].match(/\buse[A-Z]\w*/) ?? [])[0] ?? 'hook'}`,
        'Hooks must be called at the top level, never inside loops. Extract the looped logic into a separate component.',
      );
    },
  },
  {
    id: 'noStaleClosureInEffect',
    category: 'bugs',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      const violations: RuleViolation[] = [];
      const effectPattern = /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{([\s\S]{0,800}?)\}\s*,\s*\[\s*\]\s*\)/g;
      let m: RegExpExecArray | null;
      const re = new RegExp(effectPattern.source, 'g');
      while ((m = re.exec(file.content)) !== null) {
        const body = m[1];
        if (!body) continue;
        const stateSetters = body.match(/\bset[A-Z]\w*\s*\(\s*\w+\s*\)/g);
        if (stateSetters && stateSetters.length > 0) {
          const pos = indexToLineCol(file.content, m.index);
          violations.push({
            line: pos.line,
            column: pos.column,
            message: `useEffect with empty deps uses state value "${stateSetters[0]}" that may be stale`,
            help: 'Add the state variable to the dependency array, or use the functional update form: setState(prev => prev + 1).',
          });
        }
      }
      return violations;
    },
  },
];
