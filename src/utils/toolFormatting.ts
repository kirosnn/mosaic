import { formatWriteToolResult, formatEditToolResult } from './diff';

const TOOL_BODY_INDENT = 2;

export const DEFAULT_MAX_TOOL_LINES = 10;

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  list: 'List',
  create_directory: 'Mkdir',
  glob: 'Glob',
  grep: 'Grep',
  bash: 'Command',
  question: 'Question',
  explore: 'Explore',
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
  return [...visibleLines, `(${hiddenCount} more lines)`];
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
    case 'read':
    case 'write':
    case 'edit':
    case 'list':
    case 'create_directory':
    case 'glob':
    case 'grep':
    case 'bash': {
      return null;
    }

    case 'question': {
      const prompt = typeof args.prompt === 'string' ? args.prompt : '';
      return prompt ? `prompt: "${prompt}"` : null;
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
    case 'read':
    case 'write':
    case 'edit':
    case 'list':
    case 'create_directory':
      return path ? `${displayName} (${path})` : displayName;
    case 'glob': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      return pattern ? `${displayName} (${pattern})` : displayName;
    }
    case 'grep': {
      const pattern = typeof args.file_pattern === 'string' ? args.file_pattern : '';
      return pattern ? `${displayName} (pattern: ${pattern})` : displayName;
    }
    case 'bash': {
      const command = typeof args.command === 'string' ? args.command : '';
      const cleanCommand = command.replace(/\s+--timeout\s+\d+$/, '');
      return cleanCommand ? `${displayName} (${cleanCommand})` : displayName;
    }
    case 'explore': {
      const calls = Array.isArray(args.calls) ? args.calls : [];
      return `${displayName} (${calls.length} tools)`;
    }
    default:
      return displayName;
  }
}

export function parseToolHeader(toolName: string, args: Record<string, unknown>): { name: string; info: string | null } {
  const displayName = getToolDisplayName(toolName);
  const path = typeof args.path === 'string' ? args.path : '';

  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
    case 'list':
    case 'create_directory':
      return { name: displayName, info: path || null };
    case 'glob': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      return { name: displayName, info: pattern || null };
    }
    case 'grep': {
      const pattern = typeof args.file_pattern === 'string' ? args.file_pattern : '';
      return { name: displayName, info: pattern ? `pattern: ${pattern}` : null };
    }
    case 'bash': {
      const command = typeof args.command === 'string' ? args.command : '';
      const cleanCommand = command.replace(/\s+--timeout\s+\d+$/, '');
      return { name: displayName, info: cleanCommand || null };
    }
    case 'explore': {
      const calls = Array.isArray(args.calls) ? args.calls : [];
      return { name: displayName, info: `${calls.length} tools` };
    }
    default:
      return { name: displayName, info: null };
  }
}

function getLineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function formatListTree(result: unknown): string[] {
  if (typeof result !== 'string') return [];
  try {
    const parsed = JSON.parse(result) as Array<{ name?: string; path?: string; type?: string }>;
    if (!Array.isArray(parsed)) return [];

    const entries = parsed
      .map((e) => ({
        name: typeof e.name === 'string' ? e.name : (typeof e.path === 'string' ? e.path : ''),
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

function formatGrepResult(result: unknown): string[] {
  if (typeof result !== 'string') return [];
  try {
    const parsed = JSON.parse(result);

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return ['No results'];

      if (typeof parsed[0] === 'string') {
        return parsed.map(file => `  ${file}`);
      }

      if (typeof parsed[0] === 'object' && parsed[0] !== null) {
        const lines: string[] = [];
        for (const item of parsed) {
          if (item.file) {
            lines.push(`${item.file}:`);
            if (Array.isArray(item.matches)) {
              for (const match of item.matches) {
                if (match.line && match.content) {
                  lines.push(`  ${match.line}: ${match.content.trim()}`);
                }
              }
            }
          }
        }
        return lines.length > 0 ? lines : ['No matches'];
      }
    }

    return [result];
  } catch {
    return typeof result === 'string' ? [result] : [];
  }
}

function getToolErrorText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;

  const userMessage = obj.userMessage;
  if (typeof userMessage === 'string' && userMessage.trim()) {
    return userMessage.trim();
  }

  const error = obj.error;
  return typeof error === 'string' && error.trim() ? error.trim() : null;
}

function formatToolBodyLines(toolName: string, args: Record<string, unknown>, result: unknown): string[] {
  const errorText = getToolErrorText(result);
  if (errorText) return [`Tool error: ${errorText}`];

  switch (toolName) {
    case 'read': {
      const content = typeof result === 'string' ? result : '';
      const lineCount = getLineCount(content);
      return [`Read ${lineCount} lines`];
    }

    case 'write': {
      const append = args.append === true;
      return formatWriteToolResult(result, append);
    }

    case 'edit': {
      return formatEditToolResult(result);
    }

    case 'create_directory': {
      return ['Created'];
    }

    case 'list': {
      const treeLines = formatListTree(result);
      return treeLines.length > 0 ? treeLines : ['(empty)'];
    }

    case 'glob': {
      if (typeof result !== 'string') {
        return ['Error: result is not a string'];
      }

      const trimmed = result.trim();
      if (!trimmed) return ['No results (empty response)'];
      if (trimmed === '[]') return ['No results'];

      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return [`Error: result is not an array (${typeof parsed})`];
        }
        if (parsed.length === 0) {
          return ['No results'];
        }
        return parsed.map((file: string) => `  ${file}`);
      } catch (error) {
        return [`Parse error: ${error instanceof Error ? error.message : 'unknown'}`, `Raw result: ${result.substring(0, 200)}`];
      }
    }

    case 'grep': {
      return formatGrepResult(result);
    }

    case 'question': {
      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        const label = typeof obj.label === 'string' ? obj.label : '';
        const value = typeof obj.value === 'string' ? obj.value : '';
        if (label && value) return [`Selected: ${label} (${value})`];
        if (label) return [`Selected: ${label}`];
        if (value) return [`Selected: ${value}`];
      }
      return ['Selected'];
    }

    case 'explore': {
      if (typeof result !== 'string') return ['Error: invalid result'];
      try {
        const parsed = JSON.parse(result) as Array<{
          index: number;
          tool: string;
          args: Record<string, unknown>;
          success: boolean;
          result?: string;
          error?: string;
        }>;
        if (!Array.isArray(parsed)) return ['Error: result is not an array'];

        const lines: string[] = [];
        for (const item of parsed) {
          const toolDisplay = getToolDisplayName(item.tool);
          const argInfo = item.args.path || item.args.pattern || '';
          const status = item.success ? 'ok' : 'error';
          const statusIcon = item.success ? '+' : '-';
          lines.push(`${statusIcon} ${toolDisplay}${argInfo ? ` (${argInfo})` : ''}: ${status}`);
        }
        return lines.length > 0 ? lines : ['No results'];
      } catch {
        return ['Error parsing results'];
      }
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

  const skipTruncate = toolName === 'write' || toolName === 'edit';
  if (skipTruncate) {
    return lines.join('\n');
  }

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

export function formatErrorMessage(errorType: 'API' | 'Mosaic' | 'Tool', errorMessage: string): string {
  return `${errorType} Error\n${errorMessage}`;
}