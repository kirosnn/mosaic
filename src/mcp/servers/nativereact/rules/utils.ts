import type { RuleViolation } from '../types.js';

export function indexToLineCol(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = (before.match(/\n/g) || []).length + 1;
  const lastNewline = before.lastIndexOf('\n');
  const column = lastNewline === -1 ? index + 1 : index - lastNewline;
  return { line, column };
}

export function scanLines(
  lines: string[],
  pattern: RegExp,
  message: string | ((match: RegExpExecArray) => string),
  help: string,
  filter?: (line: string, lineIndex: number, lines: string[]) => boolean,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (filter && !filter(line, i, lines)) continue;
    const re = new RegExp(pattern.source, 'g' + pattern.flags.replace(/g/g, ''));
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      violations.push({
        line: i + 1,
        column: match.index + 1,
        message: typeof message === 'function' ? message(match) : message,
        help,
      });
    }
  }
  return violations;
}

export function scanContent(
  content: string,
  pattern: RegExp,
  message: string | ((match: RegExpExecArray) => string),
  help: string,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const flags = 'g' + (pattern.flags.includes('s') ? 's' : '') + (pattern.flags.includes('m') ? 'm' : '');
  const re = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const pos = indexToLineCol(content, match.index);
    violations.push({
      line: pos.line,
      column: pos.column,
      message: typeof message === 'function' ? message(match) : message,
      help,
    });
  }
  return violations;
}

export function findBlockEnd(content: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractBlocks(content: string, pattern: RegExp): Array<{ start: number; end: number; matchEnd: number }> {
  const blocks: Array<{ start: number; end: number; matchEnd: number }> = [];
  const re = new RegExp(pattern.source, 'g' + pattern.flags.replace(/g/g, ''));
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const braceStart = content.indexOf('{', match.index + match[0].length - 1);
    if (braceStart === -1) continue;
    const end = findBlockEnd(content, braceStart);
    if (end !== -1) {
      blocks.push({ start: match.index, end, matchEnd: match.index + match[0].length });
    }
  }
  return blocks;
}

export function countOccurrences(content: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, 'g');
  return (content.match(re) || []).length;
}
