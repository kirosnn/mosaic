import type { Rule } from '../types.js';
import { scanLines, scanContent } from './utils.js';

export const correctnessRules: Rule[] = [
  {
    id: 'noArrayIndexAsKey',
    category: 'correctness',
    severity: 'warning',
    jsxOnly: true,
    check(file) {
      const violations = [];
      const mapPattern = /\.map\s*\(\s*\(\s*\w+\s*,\s*(\w+)\s*\)/g;
      let m: RegExpExecArray | null;
      const re = new RegExp(mapPattern.source, 'g');
      while ((m = re.exec(file.content)) !== null) {
        const indexVar = m[1];
        const blockStart = file.content.indexOf('=>', m.index + m[0].length);
        if (blockStart === -1) continue;
        const blockEnd = Math.min(blockStart + 800, file.content.length);
        const block = file.content.slice(blockStart, blockEnd);
        const keyPattern = new RegExp(`key\\s*=\\s*\\{\\s*${indexVar}\\s*\\}`);
        if (keyPattern.test(block)) {
          const before = file.content.slice(0, m.index);
          const line = (before.match(/\n/g) || []).length + 1;
          violations.push({
            line,
            column: m.index - before.lastIndexOf('\n'),
            message: `Array index "${indexVar}" used as React key prop`,
            help: 'Use a stable unique identifier (e.g. item.id) as key. Index causes bugs when the list is reordered or items are added/removed.',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'renderingConditionalRender',
    category: 'correctness',
    severity: 'error',
    jsxOnly: true,
    check(file) {
      return scanContent(
        file.content,
        /\{(?:\s*\w+(?:\.\w+)*\s*)\.length\s*&&/,
        '`.length &&` in JSX may render "0" when the array is empty',
        'Use `.length > 0 &&` or a ternary expression to avoid rendering "0".',
      );
    },
  },
  {
    id: 'noPreventDefault',
    category: 'correctness',
    severity: 'warning',
    check(file) {
      return scanLines(
        file.lines,
        /e\.preventDefault\s*\(\s*\)\s*;\s*$/,
        'Bare preventDefault() with no return or further logic may not be intentional',
        'Ensure preventDefault() is called intentionally. For links, consider using router navigation instead.',
        (line) => line.includes('preventDefault') && !line.includes('//'),
      );
    },
  },
];
