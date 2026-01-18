export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  lineNumber: number | null;
  content: string;
}

export interface DiffResult {
  lines: DiffLine[];
  hasChanges: boolean;
}

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
      }
    }
  }

  return dp;
}

function backtrackLCS(
  a: string[],
  b: string[],
  dp: number[][],
  i: number,
  j: number,
  result: DiffLine[]
): void {
  if (i === 0 && j === 0) return;

  if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
    backtrackLCS(a, b, dp, i - 1, j - 1, result);
    result.push({
      type: 'unchanged',
      lineNumber: i,
      content: a[i - 1] ?? '',
    });
  } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
    backtrackLCS(a, b, dp, i, j - 1, result);
    result.push({
      type: 'added',
      lineNumber: null,
      content: b[j - 1] ?? '',
    });
  } else if (i > 0) {
    backtrackLCS(a, b, dp, i - 1, j, result);
    result.push({
      type: 'removed',
      lineNumber: i,
      content: a[i - 1] ?? '',
    });
  }
}

export function generateDiff(oldContent: string, newContent: string): DiffResult {
  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');

  const dp = computeLCS(oldLines, newLines);
  const diffLines: DiffLine[] = [];

  backtrackLCS(oldLines, newLines, dp, oldLines.length, newLines.length, diffLines);

  const hasChanges = diffLines.some(line => line.type !== 'unchanged');

  return {
    lines: diffLines,
    hasChanges,
  };
}

export function formatDiffForDisplay(diff: DiffResult, maxLines = 0): string[] {
  const result: string[] = [];
  let addedLineNumber = 1;
  let removedLineNumber = 1;

  for (const line of diff.lines) {
    if (maxLines > 0 && result.length >= maxLines) {
      const remaining = diff.lines.length - result.length;
      if (remaining > 0) {
        result.push(`... (${remaining} more lines)`);
      }
      break;
    }

    switch (line.type) {
      case 'added':
        result.push(`+${String(addedLineNumber).padStart(4)} | ${line.content}`);
        addedLineNumber++;
        break;
      case 'removed':
        result.push(`-${String(removedLineNumber).padStart(4)} | ${line.content}`);
        removedLineNumber++;
        break;
      case 'unchanged':
        addedLineNumber++;
        removedLineNumber++;
        break;
    }
  }

  return result;
}

export function formatWriteToolResult(result: unknown, isAppend: boolean): string[] {
  if (isAppend) return ['Appended'];

  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const diff = obj.diff;
    if (Array.isArray(diff)) {
      if (diff.length === 0) return ['No changes'];
      const maxLines = 10;
      if (diff.length > maxLines) {
        const visibleDiff = diff.slice(0, maxLines);
        const remaining = diff.length - maxLines;
        return [...visibleDiff, `(${remaining} more lines)`];
      }
      return diff as string[];
    }
  }

  const resultStr = typeof result === 'string' ? result : '';
  const lineCount = resultStr ? resultStr.split('\n').length : 0;
  return lineCount > 0 ? [`Wrote ${lineCount} lines`] : ['Done'];
}

export function formatEditToolResult(result: unknown): string[] {
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const diff = obj.diff;
    if (Array.isArray(diff)) {
      if (diff.length === 0) return ['No changes'];
      return diff as string[];
    }
  }

  const resultStr = typeof result === 'string' ? result : '';
  const lineCount = resultStr ? resultStr.split('\n').length : 0;
  return lineCount > 0 ? [`Edited ${lineCount} lines`] : ['Edited'];
}

export interface ParsedDiffLine {
  isDiffLine: boolean;
  prefix?: '+' | '-';
  lineNumber?: string;
  content?: string;
  isAdded: boolean;
  isRemoved: boolean;
}

export function parseDiffLine(line: string): ParsedDiffLine {
  const match = line.match(/^([+-])\s*(\d+)\s*\|?\s*(.*)$/);

  if (!match) {
    return {
      isDiffLine: false,
      isAdded: false,
      isRemoved: false,
    };
  }

  const [, prefix, lineNum, content] = match;
  const isAdded = prefix === '+';
  const isRemoved = prefix === '-';

  return {
    isDiffLine: true,
    prefix: prefix as '+' | '-',
    lineNumber: lineNum,
    content,
    isAdded,
    isRemoved,
  };
}

export function getDiffLineColors(parsed: ParsedDiffLine): {
  labelBackground: string;
  contentBackground: string;
} {
  if (!parsed.isDiffLine) {
    return {
      labelBackground: 'transparent',
      contentBackground: 'transparent',
    };
  }

  return {
    labelBackground: parsed.isAdded ? '#0d2b0d' : parsed.isRemoved ? '#2b0d0d' : 'transparent',
    contentBackground: parsed.isAdded ? '#1a3a1a' : parsed.isRemoved ? '#3a1a1a' : 'transparent',
  };
}