import { setTerminalTitle as setAnsiTerminalTitle } from "../../utils/terminalUtils";

export function extractTitle(content: string, alreadyResolved: boolean): { title: string | null; cleanContent: string; isPending: boolean; noTitle: boolean; isTitlePseudoCall: boolean } {
  const trimmed = content.trimStart();

  const titleMatch = trimmed.match(/^<title>(.*?)<\/title>\s*/si);
  if (titleMatch) {
    const title = alreadyResolved ? null : (titleMatch[1]?.trim() || null);
    const cleanContent = trimmed.replace(/^<title>.*?<\/title>\s*/si, '');
    return { title, cleanContent, isPending: false, noTitle: false, isTitlePseudoCall: true };
  }

  const titleCallMatch = trimmed.match(/^title\s*\(\s*(?:title\s*=\s*)?(['\"])([\s\S]*?)\1\s*\)\s*/i);
  if (titleCallMatch) {
    const t = titleCallMatch[2] ?? '';
    const title = alreadyResolved ? null : (t.trim() || null);
    const cleanContent = trimmed.replace(/^title\s*\(\s*(?:title\s*=\s*)?(['\"])([\s\S]*?)\1\s*\)\s*/i, '');
    return { title, cleanContent, isPending: false, noTitle: false, isTitlePseudoCall: true };
  }

  if (alreadyResolved) {
    return { title: null, cleanContent: content, isPending: false, noTitle: false, isTitlePseudoCall: false };
  }

  const partialTitlePattern = /^<(t(i(t(l(e(>.*)?)?)?)?)?)?$/i;
  if (partialTitlePattern.test(trimmed) || (trimmed.toLowerCase().startsWith('<title>') && !trimmed.toLowerCase().includes('</title>'))) {
    return { title: null, cleanContent: '', isPending: true, noTitle: false, isTitlePseudoCall: false };
  }

  if (trimmed.toLowerCase().startsWith('title(') && !trimmed.includes(')')) {
    return { title: null, cleanContent: '', isPending: true, noTitle: false, isTitlePseudoCall: true };
  }

  return { title: null, cleanContent: content, isPending: false, noTitle: true, isTitlePseudoCall: false };
}

export function extractTitleFromToolResult(result: unknown): string | null {
  const normalize = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
  const readTitle = (value: unknown): string | null => {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const direct = typeof obj.title === 'string' ? normalize(obj.title) : '';
    if (direct) return direct;
    const nested = obj.result;
    if (typeof nested === 'string') {
      const normalized = normalize(nested);
      if (normalized) return normalized;
      return null;
    }
    if (nested && typeof nested === 'object') {
      const nestedTitle = typeof (nested as Record<string, unknown>).title === 'string'
        ? normalize((nested as Record<string, unknown>).title as string)
        : '';
      if (nestedTitle) return nestedTitle;
    }
    const output = obj.output;
    if (output && typeof output === 'object') {
      const outputTitle = typeof (output as Record<string, unknown>).title === 'string'
        ? normalize((output as Record<string, unknown>).title as string)
        : '';
      if (outputTitle) return outputTitle;
    }
    return null;
  };

  if (typeof result === 'string') {
    const trimmed = result.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      const parsedTitle = readTitle(parsed);
      if (parsedTitle) return parsedTitle;
    } catch {
    }
    const match = trimmed.match(/<title>(.*?)<\/title>/i);
    if (match && match[1]) {
      const normalized = normalize(match[1]);
      if (normalized) return normalized;
    }
    return null;
  }

  return readTitle(result);
}

export function setTerminalTitle(title: string) {
  const clean = String(title || '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return;
  try {
    setAnsiTerminalTitle(`\u2058 ${clean}`);
  } catch {
  }
  process.title = `\u2058 ${clean}`;
}
