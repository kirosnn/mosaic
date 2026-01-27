import { formatWriteToolResult, formatEditToolResult } from './diff';

const TOOL_BODY_INDENT = 2;

export const DEFAULT_MAX_TOOL_LINES = 10;

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  list: 'List',
  glob: 'Glob',
  grep: 'Grep',
  bash: 'Command',
  question: 'Question',
  explore: 'Explore',
  fetch: 'Fetch',
  plan: 'Plan',
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
    case 'glob':
    case 'grep':
    case 'bash':
    case 'explore':
    case 'fetch': {
      return null;
    }

    case 'plan': {
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

  switch (toolName) {
    case 'read':
      const readPath = typeof args.path === 'string' ? args.path : '';
      return readPath ? `${displayName} (${readPath})` : displayName;
    case 'write':
      const writePath = typeof args.path === 'string' ? args.path : '';
      return writePath ? `${displayName} (${writePath})` : displayName;
    case 'edit':
      const editPath = typeof args.path === 'string' ? args.path : '';
      return editPath ? `${displayName} (${editPath})` : displayName;
    case 'list':
      const listPath = typeof args.path === 'string' ? args.path : '';
      return listPath ? `${displayName} (${listPath})` : displayName;
    case 'glob': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      return pattern ? `${displayName} (${pattern})` : displayName;
    }
    case 'grep': {
      const query = typeof args.query === 'string' ? args.query : '';
      const fileType = typeof args.file_type === 'string' ? args.file_type : '';
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      const info = fileType ? `*.${fileType}` : pattern;
      const cleanQuery = query.replace(/[\r\n]+/g, ' ').trim();
      const queryShort = cleanQuery.length > 30 ? cleanQuery.slice(0, 30) + '...' : cleanQuery;
      return info ? `${displayName} ("${queryShort}" in ${info})` : `${displayName} ("${queryShort}")`;
    }
    case 'bash': {
      const command = typeof args.command === 'string' ? args.command : '';
      const cleanCommand = command.replace(/[\r\n]+/g, ' ').trim().replace(/\s+--timeout\s+\d+$/, '');
      return cleanCommand ? `${displayName} (${cleanCommand})` : displayName;
    }
    case 'explore': {
      const purpose = typeof args.purpose === 'string' ? args.purpose : '';
      const cleanPurpose = purpose.replace(/[\r\n]+/g, ' ').trim();
      return cleanPurpose ? `${displayName} (${cleanPurpose})` : displayName;
    }
    case 'fetch': {
      const url = typeof args.url === 'string' ? args.url : '';
      try {
        const urlObj = new URL(url);
        const shortUrl = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
        return shortUrl ? `${displayName} (${shortUrl})` : displayName;
      } catch {
        return url ? `${displayName} (${url})` : displayName;
      }
    }
    case 'plan':
      return displayName;
    default:
      return displayName;
  }
}

function formatPlanHeader(result: unknown): string {
  const displayName = getToolDisplayName('plan');
  if (!result || typeof result !== 'object') return displayName;
  const obj = result as Record<string, unknown>;
  const planItems = Array.isArray(obj.plan) ? obj.plan : [];
  const total = planItems.length;
  if (total === 0) return displayName;

  let completed = 0;
  let inProgress = 0;

  for (const item of planItems) {
    if (!item || typeof item !== 'object') continue;
    const status = typeof (item as Record<string, unknown>).status === 'string'
      ? (item as Record<string, unknown>).status
      : 'pending';
    if (status === 'completed') completed += 1;
    if (status === 'in_progress') inProgress += 1;
  }

  return `${displayName} (${completed}/${total} done, ${inProgress} in progress)`;
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
      const query = typeof args.query === 'string' ? args.query : '';
      const fileType = typeof args.file_type === 'string' ? args.file_type : '';
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      const fileInfo = fileType ? `*.${fileType}` : pattern;
      const cleanQuery = query.replace(/[\r\n]+/g, ' ').trim();
      const queryShort = cleanQuery.length > 30 ? cleanQuery.slice(0, 30) + '...' : cleanQuery;
      const info = fileInfo ? `"${queryShort}" in ${fileInfo}` : `"${queryShort}"`;
      return { name: displayName, info };
    }
    case 'bash': {
      const command = typeof args.command === 'string' ? args.command : '';
      const cleanCommand = command.replace(/[\r\n]+/g, ' ').trim().replace(/\s+--timeout\s+\d+$/, '');
      return { name: displayName, info: cleanCommand || null };
    }
    case 'explore': {
      const purpose = typeof args.purpose === 'string' ? args.purpose : '';
      return { name: displayName, info: purpose || null };
    }
    case 'fetch': {
      const url = typeof args.url === 'string' ? args.url : '';
      try {
        const urlObj = new URL(url);
        const shortUrl = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
        return { name: displayName, info: shortUrl || null };
      } catch {
        return { name: displayName, info: url || null };
      }
    }
    case 'plan':
      return { name: displayName, info: null };
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
  if (typeof result !== 'string') return ['No results returned'];

  try {
    const parsed = JSON.parse(result);

    if (typeof parsed.total_matches === 'number' && typeof parsed.files_with_matches === 'number') {
      return [`${parsed.total_matches} matches in ${parsed.files_with_matches} files`];
    }

    return ['No results returned'];
  } catch {
    return ['No results returned'];
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
  if (errorText) {
    if (toolName === 'fetch') {
      const statusMatch = errorText.match(/HTTP (\d+(?: [a-zA-Z ]+)?)/);
      if (statusMatch) {
        return [`${statusMatch[1]} - Failed to fetch`];
      }
    }
    return [`Tool error: ${errorText}`];
  }

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
      if (typeof result === 'string') {
        const lines = result.split(/\r?\n/).filter(line => line.trim());
        return lines.length > 0 ? lines : ['Exploration completed'];
      }
      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        if (typeof obj.error === 'string') {
          return [`Error: ${obj.error}`];
        }
      }
      return ['Exploration completed'];
    }

    case 'fetch': {
      if (typeof result === 'string') {
        const url = typeof args.url === 'string' ? args.url : 'URL';
        const statusMatch = result.match(/\*\*Status:\*\* (\d+(?: [a-zA-Z ]+)?)/);
        if (statusMatch) {
          return [`${statusMatch[1]} - Fetched ${url}`];
        }
        return [`Fetched ${url}`];
      }
      return ['Fetch completed'];
    }

    case 'plan': {
      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        const explanation = typeof obj.explanation === 'string' ? obj.explanation.trim() : '';
        const planItems = Array.isArray(obj.plan) ? obj.plan : [];
        const lines: string[] = [];

        if (explanation) {
          lines.push(explanation);
        }

        const normalized = planItems
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const entry = item as Record<string, unknown>;
            const step = typeof entry.step === 'string' ? entry.step : '';
            const status = typeof entry.status === 'string' ? entry.status : 'pending';
            if (!step.trim()) return null;
            return { step: step.trim(), status };
          })
          .filter((item): item is { step: string; status: string } => !!item);

        const inProgressItems = normalized.filter(item => item.status === 'in_progress');
        const pendingItems = normalized.filter(item => item.status === 'pending');
        const completedItems = normalized.filter(item => item.status === 'completed');

        const sectionPrefix = '  ';
        const itemPrefix = '      ';
        const arrowPrefix = '> ';

        const addSection = (label: string, items: Array<{ step: string; status: string }>, activeStep: string | null, marker: string) => {
          if (items.length === 0) return;
          lines.push(`${sectionPrefix}${label} (${items.length})`);
          for (const item of items) {
            const isActive = activeStep !== null && item.step === activeStep;
            const prefix = isActive ? arrowPrefix : arrowPrefix;
            lines.push(`${itemPrefix}${prefix}${marker} ${item.step}`);
          }
        };

        addSection('In progress', inProgressItems, inProgressItems[0]?.step ?? null, '[~]');
        addSection('Todo', pendingItems, null, '[ ]');
        addSection('Completed', completedItems, null, '[✓]');

        return lines.length > 0 ? lines : ['(no steps)'];
      }
      return ['(no steps)'];
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
  const header = toolName === 'plan' ? formatPlanHeader(result) : formatToolHeader(toolName, args);
  const lines: string[] = [header];

  const argsLine = formatKnownToolArgs(toolName, args);
  if (argsLine) lines.push(argsLine);

  const bodyLines = formatToolBodyLines(toolName, args, result);
  for (const line of bodyLines) lines.push(line);

  const skipTruncate = toolName === 'write' || toolName === 'edit' || toolName === 'plan';
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
