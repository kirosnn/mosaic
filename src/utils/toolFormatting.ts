const TOOL_BODY_INDENT = 2;

export const DEFAULT_MAX_TOOL_LINES = 10;

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: 'Read',
  write_file: 'Write',
  list_files: 'List',
  execute_command: 'Command',
};

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName;
}

function truncateLines(lines: string[], maxLines?: number): string[] {
  if (!maxLines || maxLines <= 0) return lines;
  if (lines.length <= maxLines) return lines;

  if (maxLines === 1) return [lines[0] || ''];

  const visibleLines = lines.slice(0, Math.max(0, maxLines - 1));
  const hiddenCount = Math.max(0, lines.length - visibleLines.length);
  return [...visibleLines, `(.. ${hiddenCount} more lines)`];
}

export function formatToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return '';
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatKnownToolArgs(toolName: string, args: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'read_file':
    case 'write_file':
    case 'list_files': {
      return null;
    }

    case 'execute_command': {
      const command = typeof args.command === 'string' ? args.command : '';
      return command ? `command: ${command}` : null;
    }

    default: {
      const keys = Object.keys(args);
      if (keys.length === 0) return null;
      try {
        return `args: ${JSON.stringify(args)}`;
      } catch {
        return 'args: [unserializable]';
      }
    }
  }
}

export function isToolSuccess(result: unknown): boolean {
  if (result === null || result === undefined) return false;

  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (obj.success === false) return false;
    if (typeof obj.error === 'string' && obj.error.trim()) return false;
    if ('error' in obj && obj.error !== undefined && obj.error !== null) return false;
    return true;
  }

  return typeof result === 'string';
}

function formatToolHeader(toolName: string, args: Record<string, unknown>): string {
  const displayName = getToolDisplayName(toolName);
  const path = typeof args.path === 'string' ? args.path : '';

  switch (toolName) {
    case 'read_file':
    case 'write_file':
    case 'list_files':
      return path ? `${displayName} (${path})` : displayName;
    default:
      return displayName;
  }
}

function getLineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function formatListTree(result: unknown): string[] {
  if (typeof result !== 'string') return [];
  try {
    const parsed = JSON.parse(result) as Array<{ name?: string; type?: string }>;
    if (!Array.isArray(parsed)) return [];

    const entries = parsed
      .map((e) => ({
        name: typeof e.name === 'string' ? e.name : '',
        type: typeof e.type === 'string' ? e.type : '',
      }))
      .filter((e) => e.name);

    const dirs = entries
      .filter((e) => e.type === 'directory')
      .map((e) => `${e.name}/`)
      .sort((a, b) => a.localeCompare(b));

    const files = entries
      .filter((e) => e.type !== 'directory')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    return [...dirs, ...files];
  } catch {
    return [];
  }
}

function formatToolBodyLines(toolName: string, args: Record<string, unknown>, result: unknown): string[] {
  switch (toolName) {
    case 'read_file': {
      const path = typeof args.path === 'string' ? args.path : '';
      const content = typeof result === 'string' ? result : '';
      const lineCount = getLineCount(content);
      const label = path ? `Read ${lineCount} lines` : `Read ${lineCount} lines`;
      return [label];
    }

    case 'write_file': {
      return ['Done'];
    }

    case 'list_files': {
      const treeLines = formatListTree(result);
      return treeLines.length > 0 ? treeLines : ['(empty)'];
    }

    default: {
      const toolResultText = formatToolResult(result);
      if (!toolResultText) return [];
      return toolResultText.split(/\r?\n/);
    }
  }
}

export function formatToolContent(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  options?: {
    maxLines?: number;
  }
): string {
  const lines: string[] = [formatToolHeader(toolName, args)];

  const argsLine = formatKnownToolArgs(toolName, args);
  if (argsLine) lines.push(argsLine);

  const bodyLines = formatToolBodyLines(toolName, args, result);
  for (const line of bodyLines) lines.push(line);

  return truncateLines(lines, options?.maxLines).join('\n');
}

export function formatToolMessage(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  options?: {
    maxLines?: number;
  }
): {
  content: string;
  success: boolean;
} {
  return {
    content: formatToolContent(toolName, args, result, options),
    success: isToolSuccess(result),
  };
}

export function getToolParagraphIndent(paragraphIndex: number): number {
  return paragraphIndex > 0 ? TOOL_BODY_INDENT : 0;
}

export function getToolWrapTarget(paragraph: string, paragraphIndex: number): string {
  return paragraphIndex > 0 ? paragraph.trimStart() : paragraph;
}

export function getToolWrapWidth(maxWidth: number, paragraphIndex: number): number {
  return Math.max(1, maxWidth - getToolParagraphIndent(paragraphIndex));
}