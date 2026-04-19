import type { AgentMessage } from './types';

export const CONTINUATION_LEDGER_PREFIX = 'TOOL LEDGER (continuation context):';
const CONTINUATION_TOOL_SKIP = new Set(['title', 'question', 'abort', 'review']);

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function sampleList(values: string[], maxItems: number): string {
  const shown = values.slice(0, maxItems);
  const suffix = values.length > maxItems ? ` (+${values.length - maxItems} more)` : '';
  return `${shown.join(', ')}${suffix}`;
}

function summarizeReadResult(path: string, result: string): string {
  const lines = result.split('\n').length;
  const compact = result.replace(/\s+/g, ' ').trim();
  const excerpt = compact ? truncateText(compact, 180) : '[empty]';
  return `${path || 'file'} => ${lines} lines, ${result.length} chars, excerpt: ${excerpt}`;
}

function summarizeDiscoveryResult(toolName: string, result: unknown): string | null {
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;

    if (toolName === 'glob' && Array.isArray(parsed)) {
      const values = parsed.filter((value): value is string => typeof value === 'string');
      return `${values.length} files: ${sampleList(values, 6)}`;
    }

    if (toolName === 'list') {
      if (Array.isArray(parsed)) {
        const values = parsed
          .map((entry) => typeof entry?.name === 'string' ? entry.name : '')
          .filter(Boolean);
        return `${values.length} items: ${sampleList(values, 6)}`;
      }
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { files?: unknown[] }).files)) {
        const files = (parsed as { files: Array<{ path?: string; name?: string }> }).files;
        const values = files
          .map((entry) => entry.path || entry.name || '')
          .filter(Boolean);
        const truncated = (parsed as { truncated?: boolean }).truncated === true ? ' (truncated)' : '';
        return `${values.length} items${truncated}: ${sampleList(values, 6)}`;
      }
    }

    if (toolName === 'grep' && parsed && typeof parsed === 'object') {
      const totalMatches = typeof (parsed as { total_matches?: number }).total_matches === 'number'
        ? (parsed as { total_matches: number }).total_matches
        : 0;
      const filesWithMatches = typeof (parsed as { files_with_matches?: number }).files_with_matches === 'number'
        ? (parsed as { files_with_matches: number }).files_with_matches
        : 0;
      const resultFiles = Array.isArray((parsed as { results?: Array<{ file?: string }> }).results)
        ? ((parsed as { results: Array<{ file?: string }> }).results.map((entry) => entry.file || '').filter(Boolean))
        : [];
      const countFiles = Array.isArray((parsed as { counts?: Array<{ file?: string }> }).counts)
        ? ((parsed as { counts: Array<{ file?: string }> }).counts.map((entry) => entry.file || '').filter(Boolean))
        : [];
      const files = resultFiles.length > 0 ? resultFiles : countFiles;
      const truncated = (parsed as { truncated?: boolean }).truncated === true ? ' (truncated)' : '';
      return `${totalMatches} matches in ${filesWithMatches} files${truncated}: ${sampleList(files, 6)}`;
    }
  } catch {
  }

  return null;
}

export function summarizeToolResultForContinuation(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
): { summary: string; rawChars: number; guarded: boolean } {
  const raw = stringifyUnknown(toolResult);
  const rawChars = raw.length;
  const path = typeof toolArgs.path === 'string' ? toolArgs.path : '';

  if (toolName === 'read' && typeof toolResult === 'string') {
    return {
      summary: summarizeReadResult(path, toolResult),
      rawChars,
      guarded: toolResult.length > 1200,
    };
  }

  if (toolName === 'glob' || toolName === 'grep' || toolName === 'list') {
    const discoverySummary = summarizeDiscoveryResult(toolName, toolResult);
    if (discoverySummary) {
      return {
        summary: discoverySummary,
        rawChars,
        guarded: true,
      };
    }
  }

  return {
    summary: truncateText(raw.replace(/\s+/g, ' ').trim(), 220),
    rawChars,
    guarded: rawChars > 900,
  };
}

function buildLedgerLine(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  success: boolean,
): string {
  const status = success ? 'OK' : 'FAILED';
  const argsText = truncateText(stringifyUnknown(toolArgs).replace(/\s+/g, ' ').trim(), 80);
  const summary = summarizeToolResultForContinuation(toolName, toolArgs, toolResult).summary;
  return `- [${status}] ${toolName}(${argsText}) => ${summary}`;
}

export function applyToolResultToContinuationLedger(
  history: AgentMessage[],
  ledgerEntries: string[],
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: unknown,
  success: boolean,
  maxEntries: number,
): void {
  if (CONTINUATION_TOOL_SKIP.has(toolName)) {
    return;
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === 'assistant' && typeof msg.content === 'string' && msg.content.startsWith(CONTINUATION_LEDGER_PREFIX)) {
      history.splice(i, 1);
    }
  }

  ledgerEntries.push(buildLedgerLine(toolName, toolArgs, toolResult, success));
  if (ledgerEntries.length > maxEntries) {
    ledgerEntries.splice(0, ledgerEntries.length - maxEntries);
  }

  if (ledgerEntries.length > 0) {
    history.push({
      role: 'assistant',
      content: `${CONTINUATION_LEDGER_PREFIX}\n${ledgerEntries.join('\n')}`,
    });
  }
}
