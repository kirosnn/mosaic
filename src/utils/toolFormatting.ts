import { formatWriteToolResult, formatEditToolResult } from './diff';
import { isNativeMcpTool, getNativeMcpToolName } from '../mcp/types';

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

function parseMcpSafeId(toolName: string): { serverId: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const parts = toolName.slice(5).split('__');
  if (parts.length < 2) return null;
  const tool = parts.pop()!;
  const serverId = parts.join('__');
  return { serverId, tool };
}

function getMcpToolDisplayName(tool: string): string {
  const words = tool.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getNativeToolDisplayName(safeId: string): string | null {
  const toolName = getNativeMcpToolName(safeId);
  if (!toolName) return null;
  const mcp = parseMcpSafeId(safeId);
  if (!mcp) return null;
  const serverPrefix = mcp.serverId + '_';
  const stripped = toolName.startsWith(serverPrefix) ? toolName.slice(serverPrefix.length) : toolName;
  return getMcpToolDisplayName(stripped);
}

function getToolDisplayName(toolName: string): string {
  if (isNativeMcpTool(toolName)) {
    const nativeName = getNativeToolDisplayName(toolName);
    if (nativeName) return nativeName;
  }
  const mcp = parseMcpSafeId(toolName);
  if (mcp) {
    return getMcpToolDisplayName(mcp.tool);
  }
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

function getMcpHeaderInfo(_tool: string, args: Record<string, unknown>): string {
  const query = args.query ?? args.search ?? args.prompt ?? args.input ?? args.text ?? args.q;
  if (typeof query === 'string' && query.trim()) {
    const clean = query.replace(/[\r\n]+/g, ' ').trim();
    return clean.length > 50 ? clean.slice(0, 50) + '...' : clean;
  }

  const url = args.url ?? args.uri ?? args.href;
  if (typeof url === 'string' && url.trim()) {
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname !== '/' ? u.pathname : '');
    } catch {
      return url.length > 50 ? url.slice(0, 50) + '...' : url;
    }
  }

  const urls = args.urls;
  if (Array.isArray(urls) && urls.length > 0) {
    const first = typeof urls[0] === 'string' ? urls[0] : '';
    if (urls.length === 1) {
      try {
        return new URL(first).hostname;
      } catch {
        return first.length > 40 ? first.slice(0, 40) + '...' : first;
      }
    }
    return `${urls.length} URLs`;
  }

  const path = args.path ?? args.file ?? args.filename ?? args.filepath ?? args.name;
  if (typeof path === 'string' && path.trim()) {
    return path.length > 50 ? path.slice(0, 50) + '...' : path;
  }

  const command = args.command ?? args.cmd;
  if (typeof command === 'string' && command.trim()) {
    const clean = command.replace(/[\r\n]+/g, ' ').trim();
    return clean.length > 50 ? clean.slice(0, 50) + '...' : clean;
  }

  return '';
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
      if (toolName.startsWith('mcp__')) {
        return null;
      }
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

function formatNativeMcpError(errorText: string): string[] {
  const statusMatch = errorText.match(/status code (\d+)/i);
  if (statusMatch) {
    return [`Error ${statusMatch[1]}`];
  }
  const short = errorText.length > 80 ? errorText.slice(0, 80) + '...' : errorText;
  return [`Error: ${short}`];
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
    default: {
      if (toolName.startsWith('mcp__')) {
        const info = getMcpHeaderInfo('', args);
        if (isNativeMcpTool(toolName)) {
          return info ? `${displayName} (${info})` : displayName;
        }
        return info ? `${displayName} ("${info}")` : displayName;
      }
      return displayName;
    }
  }
}

function formatPlanHeader(result: unknown): string {
  const title = '# Todos';
  if (!result || typeof result !== 'object') return title;
  const obj = result as Record<string, unknown>;
  const planItems = Array.isArray(obj.plan) ? obj.plan : [];
  if (planItems.length === 0) return title;
  return title;
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
    default: {
      if (toolName.startsWith('mcp__')) {
        const info = getMcpHeaderInfo('', args);
        return { name: displayName, info: info || null };
      }
      return { name: displayName, info: null };
    }
  }
}

export function isNativeMcpToolName(toolName: string): boolean {
  return isNativeMcpTool(toolName);
}

function getLineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function formatListTree(result: unknown): string[] {
  if (typeof result !== 'string') return [];
  try {
    const parsed = JSON.parse(result);

    let items: Array<{ name?: string; path?: string; type?: string }>;
    let errors: string[] = [];

    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.files)) {
      items = parsed.files;
      if (Array.isArray(parsed.errors)) {
        errors = parsed.errors
          .map((e: unknown) => (typeof e === 'string' ? e : ''))
          .filter((e: string) => e);
      }
    } else {
      return [];
    }

    const entries = items
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

    const lines = [...dirs, ...files];

    if (errors.length > 0) {
      lines.push('', `Errors (${errors.length}):`);
      for (const err of errors) {
        lines.push(`  ${err}`);
      }
    }

    return lines;
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

function formatSearchResultBody(result: unknown): string[] {
  if (typeof result !== 'string') return [];
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed !== 'object' || parsed === null) return [];

    if (typeof parsed.error === 'string') {
      return [`Error: ${parsed.error}`];
    }

    const count = typeof parsed.resultCount === 'number' ? parsed.resultCount : 0;
    if (count === 0) return ['No results'];
    return [`${count} results`];
  } catch {
    return [];
  }
}

function formatMcpResultBody(result: unknown): string[] {
  if (typeof result !== 'string') {
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (typeof obj.error === 'string') {
        return [`Error: ${obj.error}`];
      }
    }
    return ['Completed'];
  }

  const text = result.trim();
  if (!text) return ['(empty result)'];

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return formatMcpArray(parsed);
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return formatMcpObject(parsed);
    }

    return [String(parsed)];
  } catch {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    return lines.length > 0 ? lines : ['Completed'];
  }
}

function formatMcpArray(arr: unknown[]): string[] {
  if (arr.length === 0) return ['(no results)'];

  const lines: string[] = [];

  for (const item of arr) {
    if (typeof item === 'string') {
      lines.push(`  ${item}`);
      continue;
    }

    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;

      if (typeof obj.error === 'string') {
        const url = typeof obj.url === 'string' ? obj.url : '';
        const detail = obj.details && typeof obj.details === 'object'
          ? (obj.details as Record<string, unknown>).detail
          : '';
        const errMsg = typeof detail === 'string' && detail ? detail : obj.error;
        lines.push(url ? `  ${url} - ${errMsg}` : `  Error: ${errMsg}`);
        continue;
      }

      const title = obj.title ?? obj.name ?? obj.label;
      const desc = obj.description ?? obj.summary ?? obj.snippet ?? obj.text ?? obj.content;
      const url = obj.url ?? obj.link ?? obj.href;

      if (typeof title === 'string' && title) {
        let line = `  ${title}`;
        if (typeof url === 'string' && url) {
          try {
            line += ` (${new URL(url).hostname})`;
          } catch {
            line += ` (${url.length > 40 ? url.slice(0, 40) + '...' : url})`;
          }
        }
        lines.push(line);
        if (typeof desc === 'string' && desc.trim()) {
          const short = desc.trim().replace(/[\r\n]+/g, ' ');
          lines.push(`    ${short.length > 80 ? short.slice(0, 80) + '...' : short}`);
        }
        continue;
      }

      if (typeof url === 'string' && url) {
        let line = `  ${url}`;
        if (typeof desc === 'string' && desc.trim()) {
          const short = desc.trim().replace(/[\r\n]+/g, ' ');
          line += ` - ${short.length > 60 ? short.slice(0, 60) + '...' : short}`;
        }
        lines.push(line);
        continue;
      }

      const keys = Object.keys(obj);
      const summary = keys.slice(0, 3).map(k => {
        const v = obj[k];
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        const short = s && s.length > 30 ? s.slice(0, 30) + '...' : s;
        return `${k}: ${short}`;
      }).join(', ');
      lines.push(`  ${summary}`);
    }
  }

  if (arr.length > 1) {
    lines.unshift(`${arr.length} results:`);
  }

  return lines.length > 0 ? lines : ['Completed'];
}

function formatMcpObject(obj: Record<string, unknown>): string[] {
  const lines: string[] = [];

  if (typeof obj.error === 'string') {
    const detail = obj.details && typeof obj.details === 'object'
      ? (obj.details as Record<string, unknown>).detail
      : '';
    const errMsg = typeof detail === 'string' && detail ? detail : obj.error;
    return [`Error: ${errMsg}`];
  }

  const status = obj.status ?? obj.statusCode ?? obj.code;
  const message = obj.message ?? obj.result ?? obj.output ?? obj.text ?? obj.content ?? obj.data;

  if (typeof status === 'number' || typeof status === 'string') {
    lines.push(`Status: ${status}`);
  }

  if (typeof message === 'string' && message.trim()) {
    const msgLines = message.trim().split(/\r?\n/);
    lines.push(...msgLines);
  } else if (message && typeof message === 'object') {
    if (Array.isArray(message)) {
      lines.push(...formatMcpArray(message));
    } else {
      const entries = Object.entries(message as Record<string, unknown>).slice(0, 5);
      for (const [k, v] of entries) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        const short = s && s.length > 60 ? s.slice(0, 60) + '...' : s;
        lines.push(`  ${k}: ${short}`);
      }
    }
  }

  if (lines.length === 0) {
    const entries = Object.entries(obj).slice(0, 5);
    for (const [k, v] of entries) {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      const short = s && s.length > 60 ? s.slice(0, 60) + '...' : s;
      lines.push(`  ${k}: ${short}`);
    }
  }

  return lines.length > 0 ? lines : ['Completed'];
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
    if (toolName.startsWith('mcp__')) {
      return formatNativeMcpError(errorText);
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

        const hasPending = normalized.some(item => item.status === 'pending');

        for (const item of normalized) {
          const displayStatus = item.status === 'in_progress' && !hasPending ? 'completed' : item.status;
          let marker = '[ ]';
          if (displayStatus === 'in_progress') marker = '[●]';
          if (displayStatus === 'completed') marker = '[✓]';
          lines.push(`${marker} ${item.step}`);
        }

        return lines.length > 0 ? lines : ['(no steps)'];
      }
      return ['(no steps)'];
    }

    default: {
      if (toolName.startsWith('mcp__')) {
        const nativeName = getNativeMcpToolName(toolName);
        if (nativeName === 'navigation_search') {
          const searchLines = formatSearchResultBody(result);
          if (searchLines.length > 0) return searchLines;
        }
        return formatMcpResultBody(result);
      }
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
  if (toolName === 'plan' && bodyLines.length > 0) {
    lines.push('');
  }
  for (const line of bodyLines) lines.push(line);

  const skipTruncate = toolName === 'write' || toolName === 'edit' || toolName === 'plan';
  if (skipTruncate) {
    return lines.join('\n');
  }

  const maxLines = toolName === 'bash'
    ? (options?.maxLines ?? DEFAULT_MAX_TOOL_LINES)
    : options?.maxLines;

  return truncateLines(lines, maxLines).join('\n');
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
