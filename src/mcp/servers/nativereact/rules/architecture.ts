import type { Rule, RuleViolation } from '../types.js';
import { scanLines, scanContent, indexToLineCol, findBlockEnd } from './utils.js';

const GIANT_COMPONENT_LINE_THRESHOLD = 300;

function findComponentSpans(content: string): Array<{ name: string; startLine: number; lineCount: number }> {
  const spans: Array<{ name: string; startLine: number; lineCount: number }> = [];
  const pattern = /(?:^|\n)([ \t]*)(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  const re = new RegExp(pattern.source, 'gm');

  while ((m = re.exec(content)) !== null) {
    const name = m[2] ?? '';
    if (!name) continue;
    const braceIdx = content.indexOf('{', m.index + m[0].length - 1);
    if (braceIdx === -1) continue;
    const endIdx = findBlockEnd(content, braceIdx);
    if (endIdx === -1) continue;
    const block = content.slice(m.index, endIdx + 1);
    const lineCount = (block.match(/\n/g) || []).length + 1;
    const startLine = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
    spans.push({ name, startLine, lineCount });
  }

  return spans;
}

export const architectureRules: Rule[] = [
  {
    id: 'noGenericHandlerNames',
    category: 'architecture',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /\b(?:const|let|var)\s+(handleClick|handleChange|handleSubmit|handleKeyDown|handleKeyPress|handleMouseOver|handleMouseOut)\b(?!\w)/,
        m => `Generic event handler name "${m[1]}"`,
        'Use descriptive handler names that explain what the handler does (e.g. handleLoginSubmit, handleEmailChange).',
      );
    },
  },
  {
    id: 'noGiantComponent',
    category: 'architecture',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      const violations: RuleViolation[] = [];
      const spans = findComponentSpans(file.content);
      for (const span of spans) {
        if (span.lineCount > GIANT_COMPONENT_LINE_THRESHOLD) {
          violations.push({
            line: span.startLine,
            column: 1,
            message: `Component "${span.name}" is ${span.lineCount} lines (limit: ${GIANT_COMPONENT_LINE_THRESHOLD})`,
            help: 'Break large components into smaller, focused sub-components. Extract logic into custom hooks.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'noNestedComponentDefinition',
    category: 'architecture',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanLines(
        file.lines,
        /^\s{2,}(?:(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:\([^)]*\)|[a-z_$])\s*=>|(?:async\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\()/,
        m => `Component "${(m[1] || m[2])}" defined inside another component`,
        'Define components at the module level, not inside other components. Nested definitions create new instances on every render, breaking memoization and state.',
        (line) => /^\s{2,}(?:const|let|var|function|async)/.test(line) && /[A-Z][a-zA-Z0-9]*/.test(line),
      );
    },
  },
  {
    id: 'noRenderInRender',
    category: 'architecture',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /return\s*\([^)]*function\s+[A-Z][a-zA-Z0-9]*\s*\(/,
        'Component function defined inside return/render expression',
        'Extract component functions outside the render method to prevent unnecessary re-creation on each render.',
      );
    },
  },
];
