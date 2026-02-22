import { readFile, writeFile, readdir, appendFile, stat, mkdir, realpath } from 'fs/promises';
import { join, resolve, dirname, extname, sep } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requestApproval } from '../../utils/approvalBridge';
import { shouldRequireApprovals } from '../../utils/config';
import { getLocalBashDecision } from '../../utils/localRules';
import { generateDiff, formatDiffForDisplay } from '../../utils/diff';
import { trackFileChange, trackFileCreated } from '../../utils/fileChangeTracker';
import { debugLog } from '../../utils/debug';
import { addPendingChange } from '../../utils/pendingChangesBridge';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const execAsync = promisify(exec);

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0';
const DEFAULT_FETCH_MAX_LENGTH = 10000;
const DEFAULT_FETCH_TIMEOUT = 30000;

const SAFE_BASH_COMMANDS = new Set([
  'ls', 'dir', 'tree', 'pwd', 'cat', 'type', 'head', 'tail', 'less', 'more', 'nl', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'which', 'where', 'whereis', 'wc', 'diff', 'cmp', 'comm', 'file', 'stat', 'readlink', 'realpath', 'du', 'df', 'env', 'printenv', 'whoami', 'id', 'hostname', 'uname', 'date', 'cal', 'uptime', 'ps', 'top', 'htop', 'pstree', 'pgrep', 'free', 'vmstat', 'iostat', 'lscpu', 'lsmem', 'ping', 'traceroute', 'tracepath', 'mtr', 'dig', 'nslookup', 'host', 'ss', 'netstat', 'lsof', 'node', 'deno', 'python', 'python3', 'ruby', 'php', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'cargo', 'rustc', 'go', 'java', 'javac', 'dotnet', 'exa', 'eza', 'bat', 'curl', 'wget',
]);

const DANGEROUS_BASH_PATTERNS = [
  /\bgit\s+(push|commit|add|reset|checkout|switch|merge|rebase|cherry-pick|stash|pull|fetch|tag|branch|remote|submodule|worktree|gc|clean)\b/i,

  /\brm\b/i, /\brmdir\b/i, /\bdel\b/i, /\berase\b/i, /\brd\b/i,
  /\bmv\b/i, /\bmove\b/i, /\bcp\b/i, /\bcopy\b/i, /\bxcopy\b/i, /\brobocopy\b/i,
  /\bmkdir\b/i, /\bmd\b/i, /\btouch\b/i, /\bln\b/i,
  /\bchmod\b/i, /\bchown\b/i, /\bchgrp\b/i, /\bchattr\b/i,

  /\bsudo\b/i, /\bsu\b/i, /\bdoas\b/i,
  /\bkill\b/i, /\bkillall\b/i, /\bpkill\b/i,

  /\bapt\b/i, /\bapt-get\b/i, /\byum\b/i, /\bdnf\b/i, /\bzypper\b/i, /\bpacman\b/i, /\bbrew\b/i, /\bport\b/i,

  /\bnpm\s+(install|i|add|uninstall|remove|update|upgrade|publish|link|ci|rebuild|audit\s+fix)\b/i,
  /\byarn\s+(add|remove|up|upgrade|set\s+version|dlx|plugin|publish|link)\b/i,
  /\bpnpm\s+(add|install|i|remove|update|upgrade|publish|link|rebuild)\b/i,
  /\bbun\s+(add|install|i|remove|update|upgrade|publish|link)\b/i,

  /\bpip\s+(install|uninstall|remove|download)\b/i,
  /\bconda\s+(install|remove|update)\b/i,

  /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask)\b/i,
  /\bservice\s+(start|stop|restart|reload)\b/i,

  /\bsed\b.*\s-i\b/i,
  /\bperl\b.*\s-pe\b/i,

  /\bsh\b/i, /\bbash\b/i, /\bzsh\b/i, /\bfish\b/i,
  /\bpython(3)?\s+-c\b/i,
  /\bnode\s+-e\b/i,
  /\bdeno\s+eval\b/i,
  /\bbun\s+-e\b/i,
  /\bpowershell\b/i, /\bpwsh\b/i, /\bcmd(\.exe)?\b/i,

  />/,
  /</,
  /\|\|/,
  /&&/,
  /;/,
  /\|/,
  /\$\(/,
  /`/,

  /\btee\b/i,
  /\bdd\b/i,

  /\bcurl\b.*\s(-d|--data|--data-raw|--data-binary|--form|-F)\b/i,
  /\bcurl\b.*\s(--upload-file|-T)\b/i,
  /\bcurl\b.*\s(@[^\s]+)/i,
  /\bcurl\b.*\s(-o|--output|-O|--remote-name|--remote-name-all)\b/i,

  /\bwget\b.*\s(--post-data|--post-file|--method=POST|--body-data|--body-file)\b/i,
  /\bwget\b.*\s(-O|--output-document|--directory-prefix)\b/i,
];

const BASH_REDIRECTION_PATTERN = /(^|[\s(])(?:\d?>>?|\d?<<?|>>?|<<?|&>>?|&>)(?=\s|$)/;

function isSafeBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  const normalized = trimmed.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  if (lower.includes('\n') || lower.includes('\r') || lower.includes('\0')) return false;

  const firstToken = normalized.split(' ')[0] ?? '';
  const firstWord = firstToken.toLowerCase();

  if (!SAFE_BASH_COMMANDS.has(firstWord)) return false;

  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(normalized)) return false;
  }

  if (firstWord === 'curl') {
    const allowed = /^curl(\s+(-I|--head|-s|--silent|-S|--show-error|-L|--location|--compressed|--max-time\s+\d+|--connect-timeout\s+\d+|--retry\s+\d+|--retry-delay\s+\d+|--fail|--fail-with-body|--http1\.1|--http2|--tlsv1(\.\d+)?|--cacert\s+\S+|--capath\s+\S+|--resolve\s+\S+|--header\s+(".*?"|'.*?'|\S+)|--user-agent\s+(".*?"|'.*?'|\S+)))*(\s+("https?:\/\/[^"]+"|'https?:\/\/[^']+'|https?:\/\/\S+))\s*$/i;
    if (!allowed.test(normalized)) return false;
  }

  if (firstWord === 'wget') {
    const allowed = /^wget(\s+(-q|--quiet|-S|--server-response|--spider|--max-redirect\s+\d+|--timeout\s+\d+|--tries\s+\d+|--wait\s+\d+|--user-agent\s+\S+))*(\s+("https?:\/\/[^"]+"|'https?:\/\/[^']+'|https?:\/\/\S+))\s*$/i;
    if (!allowed.test(normalized)) return false;
  }

  return true;
}

function splitTopLevelBashSegments(command: string): { segments: string[]; hasUnsupportedSyntax: boolean } {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? '';
    const next = command[i + 1] ?? '';

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && quote !== '\'') {
      current += ch;
      escaped = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '`' || (ch === '$' && next === '(')) {
      return { segments: [], hasUnsupportedSyntax: true };
    }

    if (ch === '&' && next !== '&') {
      return { segments: [], hasUnsupportedSyntax: true };
    }

    if (ch === ';' || ch === '|' || ch === '&') {
      const currentSegment = current.trim();
      if (!currentSegment) {
        return { segments: [], hasUnsupportedSyntax: true };
      }
      segments.push(currentSegment);
      current = '';

      if ((ch === '|' && next === '|') || (ch === '&' && next === '&')) {
        i++;
      }
      continue;
    }

    current += ch;
  }

  if (escaped || quote) {
    return { segments: [], hasUnsupportedSyntax: true };
  }

  const tail = current.trim();
  if (tail) {
    segments.push(tail);
  }

  return { segments, hasUnsupportedSyntax: false };
}

function isReadOnlyBashCommandChain(command: string): boolean {
  const parsed = splitTopLevelBashSegments(command);
  if (parsed.hasUnsupportedSyntax || parsed.segments.length <= 1) {
    return false;
  }

  for (const segment of parsed.segments) {
    if (!isSafeBashCommand(segment)) {
      return false;
    }
  }

  return true;
}

function normalizeCommandOutput(text: string): string {
  if (!text) return '';
  let s = text.replace(/\r\n/g, '\n');
  if (s.includes('\r')) {
    const parts = s.split('\n');
    s = parts.map(p => (p.includes('\r') ? (p.split('\r').pop() || '') : p)).join('\n');
  }
  s = s.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-Z\\-_])/g, '');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return s;
}

function extractContentFromHtml(html: string, url: string): { content: string; title: string | null; isSPA: boolean } {
  const { document } = parseHTML(html);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  turndown.addRule('removeScripts', {
    filter: ['script', 'style', 'noscript'],
    replacement: () => '',
  });

  turndown.addRule('preserveLinks', {
    filter: 'a',
    replacement: (content, node) => {
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute('href');
      if (!href || href.startsWith('#')) return content;

      try {
        const absoluteUrl = new URL(href, url).toString();
        return `[${content}](${absoluteUrl})`;
      } catch {
        return `[${content}](${href})`;
      }
    },
  });

  turndown.addRule('preserveImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const element = node as HTMLImageElement;
      const src = element.getAttribute('src');
      const alt = element.getAttribute('alt') || '';
      if (!src) return '';

      try {
        const absoluteUrl = new URL(src, url).toString();
        return `![${alt}](${absoluteUrl})`;
      } catch {
        return `![${alt}](${src})`;
      }
    },
  });

  const reader = new Readability(document as unknown as Document, {
    charThreshold: 0,
  });
  const article = reader.parse();

  if (article && article.content) {
    const content = turndown.turndown(article.content).trim();
    if (content.length > 50) {
      return {
        content,
        title: article.title || document.title || null,
        isSPA: false,
      };
    }
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const markdownContent = turndown.turndown(bodyContent || '').trim();

  if (markdownContent.length > 50) {
    return {
      content: markdownContent,
      title: document.title || null,
      isSPA: false,
    };
  }

  const isSPA = html.includes('id="root"') ||
    html.includes('id="app"') ||
    html.includes('id="__next"') ||
    html.includes('data-reactroot') ||
    html.includes('ng-app');

  const metaTags: string[] = [];
  const metaDescription = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const metaOgTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const metaOgDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);

  if (metaOgTitle) metaTags.push(`**Title:** ${metaOgTitle[1]}`);
  if (metaDescription) metaTags.push(`**Description:** ${metaDescription[1]}`);
  if (metaOgDescription && metaOgDescription[1] !== metaDescription?.[1]) {
    metaTags.push(`**OG Description:** ${metaOgDescription[1]}`);
  }

  let content = '';
  if (isSPA) {
    content = `*This appears to be a Single Page Application (SPA/React/Vue/Angular). The content is rendered client-side with JavaScript and cannot be extracted via simple HTTP fetch.*\n\n`;
    if (metaTags.length > 0) {
      content += `**Available metadata:**\n${metaTags.join('\n')}\n\n`;
    }
    content += `*To see the actual content, you would need a headless browser. Try using raw=true to see the HTML source.*`;
  } else if (markdownContent) {
    content = markdownContent;
  } else {
    content = `*No readable content could be extracted from this page.*\n\n`;
    if (metaTags.length > 0) {
      content += `**Available metadata:**\n${metaTags.join('\n')}`;
    }
  }

  return {
    content,
    title: document.title || null,
    isSPA,
  };
}

async function fetchUrlContent(
  url: string,
  options: {
    raw?: boolean;
    timeout?: number;
    userAgent?: string;
  } = {}
): Promise<{ content: string; contentType: string; title: string | null; status: number; statusText: string; isSPA?: boolean }> {
  const { raw = false, timeout = DEFAULT_FETCH_TIMEOUT, userAgent = DEFAULT_USER_AGENT } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await globalThis.fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    const status = response.status;
    const statusText = response.statusText;

    if (!response.ok) {
      throw new Error(`HTTP ${status} ${statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    const isHtml = contentType.includes('text/html') ||
      text.slice(0, 500).toLowerCase().includes('<html') ||
      text.slice(0, 500).toLowerCase().includes('<!doctype html');

    if (isHtml && !raw) {
      const { content, title, isSPA } = extractContentFromHtml(text, url);
      return { content, contentType, title, isSPA, status, statusText };
    }

    return { content: text, contentType, title: null, status, statusText };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
  userMessage?: string;
  diff?: string[];
}

export interface ExecuteToolOptions {
  skipApproval?: boolean;
}

const globPatternCache = new Map<string, RegExp>();

async function validatePath(fullPath: string, workspace: string): Promise<boolean> {
  const normalizedWorkspace = workspace.endsWith(sep) ? workspace : workspace + sep;

  try {
    const resolved = await realpath(fullPath);
    return resolved === workspace || resolved.startsWith(normalizedWorkspace);
  } catch {
    const parent = dirname(fullPath);
    try {
      const resolvedParent = await realpath(parent);
      return resolvedParent === workspace || resolvedParent.startsWith(normalizedWorkspace);
    } catch {
      return fullPath === workspace || fullPath.startsWith(normalizedWorkspace);
    }
  }
}

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  'vendor',
  'target',
  '.idea',
  '.vscode',
]);

const BASH_REVIEW_MAX_FILES = 2000;
const BASH_REVIEW_MAX_FILE_BYTES = 512 * 1024;
const BASH_REVIEW_MAX_TOTAL_BYTES = 12 * 1024 * 1024;

interface WorkspaceReviewSnapshot {
  files: Map<string, string>;
  truncated: boolean;
  skipped: number;
}

function normalizeWorkspaceRelativePath(path: string): string {
  return path.split(sep).join('/');
}

function shouldTrackBashFileChanges(command: string): boolean {
  const trimmed = (command || '').trim();
  if (!trimmed) return false;

  const mutationPattern = /\b(remove-item|ri|del|erase|rmdir|rm|move-item|mv|copy-item|cp|xcopy|robocopy|new-item|mkdir|md|rename-item|ren|set-content|add-content|clear-content|out-file|touch|truncate)\b/i;
  if (mutationPattern.test(trimmed)) return true;
  if (/\bsed\b.*\s-i\b/i.test(trimmed)) return true;
  if (/\bperl\b.*\s-pe\b/i.test(trimmed)) return true;
  if (BASH_REDIRECTION_PATTERN.test(trimmed)) return true;
  if (isReadOnlyBashCommandChain(trimmed)) return false;

  return !isSafeBashCommand(trimmed);
}

async function captureWorkspaceReviewSnapshot(workspace: string): Promise<WorkspaceReviewSnapshot> {
  const files = new Map<string, string>();
  const stack: string[] = [''];
  let truncated = false;
  let skipped = 0;
  let totalBytes = 0;

  while (stack.length > 0) {
    const relDir = stack.pop() ?? '';
    const absDir = relDir ? resolve(workspace, relDir) : workspace;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const relPath = relDir ? join(relDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        stack.push(relPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (files.size >= BASH_REVIEW_MAX_FILES) {
        truncated = true;
        continue;
      }

      const absPath = resolve(workspace, relPath);
      let fileStats;
      try {
        fileStats = await stat(absPath);
      } catch {
        continue;
      }

      if (fileStats.size > BASH_REVIEW_MAX_FILE_BYTES || (totalBytes + fileStats.size) > BASH_REVIEW_MAX_TOTAL_BYTES) {
        skipped++;
        continue;
      }

      let raw: Buffer;
      try {
        raw = await readFile(absPath);
      } catch {
        continue;
      }

      if (isBinaryFile(raw)) {
        skipped++;
        continue;
      }

      const content = raw.toString('utf-8');
      if (content.includes('\u0000')) {
        skipped++;
        continue;
      }

      files.set(normalizeWorkspaceRelativePath(relPath), content);
      totalBytes += raw.length;
    }
  }

  return { files, truncated, skipped };
}

async function trackBashWorkspaceChanges(workspace: string, before: WorkspaceReviewSnapshot | null): Promise<number> {
  if (!before) return 0;
  const after = await captureWorkspaceReviewSnapshot(workspace);
  const allPaths = Array.from(new Set([...before.files.keys(), ...after.files.keys()])).sort((a, b) => a.localeCompare(b));
  let changedCount = 0;

  for (const path of allPaths) {
    const oldContent = before.files.get(path) ?? '';
    const newContent = after.files.get(path) ?? '';
    if (oldContent === newContent) continue;

    trackFileChange(path, oldContent, newContent);

    const diff = generateDiff(oldContent, newContent);
    const diffLines = formatDiffForDisplay(diff, 0);
    const type: 'write' | 'edit' | 'delete' = oldContent === '' ? 'write' : (newContent === '' ? 'delete' : 'edit');
    const title = type === 'write'
      ? `Create (${path})`
      : type === 'delete'
        ? `Delete (${path})`
        : `Edit (${path})`;

    addPendingChange(type, path, oldContent, newContent, {
      title,
      content: diffLines.join('\n'),
    });
    changedCount++;
  }

  if (before.truncated || before.skipped > 0 || after.truncated || after.skipped > 0) {
    debugLog(`[tool] bash review snapshot limits reached before={files:${before.files.size},truncated:${before.truncated},skipped:${before.skipped}} after={files:${after.files.size},truncated:${after.truncated},skipped:${after.skipped}}`);
  }

  return changedCount;
}

function matchGlob(filename: string, pattern: string): boolean {
  let regex = globPatternCache.get(pattern);

  if (!regex) {
    const normalizedPattern = pattern.replace(/\\/g, '/');

    let regexPattern = normalizedPattern.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');

    regexPattern = regexPattern
      .replace(/\\\*\\\*\\\//g, '(?:(?:[^/]+/)*)')
      .replace(/\\\/\*\\\*$/g, '(?:/.*)?')
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '[^/]*')
      .replace(/\\\?/g, '[^/]');

    regex = new RegExp(`^${regexPattern}$`, 'i');
    globPatternCache.set(pattern, regex);

    if (globPatternCache.size > 100) {
      const firstKey = globPatternCache.keys().next().value;
      if (firstKey) globPatternCache.delete(firstKey);
    }
  }

  const normalizedFilename = filename.replace(/\\/g, '/');
  return regex.test(normalizedFilename);
}

interface SearchResult {
  matches: Array<{ line: number; content: string; context?: { before: string[]; after: string[] } }>;
  error?: string;
  matchCount?: number;
  skipped?: boolean;
  skipReason?: string;
}

interface SearchOptions {
  caseSensitive: boolean;
  isRegex: boolean;
  wholeWord: boolean;
  multiline: boolean;
  contextBefore: number;
  contextAfter: number;
  maxFileSize: number;
  invertMatch: boolean;
}

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

function isBinaryFile(buffer: Buffer, bytesToCheck = 8000): boolean {
  const checkLength = Math.min(buffer.length, bytesToCheck);
  let nullCount = 0;
  let controlCount = 0;

  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];
    if (byte === 0) {
      nullCount++;
      if (nullCount > 1) return true;
    }
    if (byte !== undefined && byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlCount++;
      if (controlCount > checkLength * 0.1) return true;
    }
  }

  return false;
}

function escapeRegexForLiteral(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchRegex(query: string, options: SearchOptions): { regex: RegExp; error?: undefined } | { regex?: undefined; error: string } {
  try {
    let pattern = query;

    if (!options.isRegex) {
      pattern = escapeRegexForLiteral(query);
    }

    if (options.wholeWord) {
      if (options.isRegex) {
        pattern = `(?:^|\\b)${pattern}(?:\\b|$)`;
      } else {
        pattern = `\\b${pattern}\\b`;
      }
    }

    let flags = 'g';
    if (!options.caseSensitive) flags += 'i';
    if (options.multiline) flags += 'm';

    return { regex: new RegExp(pattern, flags) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid pattern' };
  }
}

async function searchInFile(filePath: string, query: string, options: SearchOptions): Promise<SearchResult> {
  try {
    const stats = await stat(filePath);

    if (stats.size > options.maxFileSize) {
      return {
        matches: [],
        skipped: true,
        skipReason: `File too large (${Math.round(stats.size / 1024)}KB > ${Math.round(options.maxFileSize / 1024)}KB)`
      };
    }

    const buffer = await readFile(filePath);

    if (isBinaryFile(buffer)) {
      return {
        matches: [],
        skipped: true,
        skipReason: 'Binary file'
      };
    }

    const content = buffer.toString('utf-8');
    const lines = content.split('\n');

    const regexResult = buildSearchRegex(query, options);
    if (regexResult.error || !regexResult.regex) {
      return { matches: [], error: regexResult.error ?? 'Failed to build search pattern' };
    }
    const regex: RegExp = regexResult.regex;

    if (options.invertMatch) {
      const hasMatch = lines.some(line => regex.test(line));
      return {
        matches: [],
        matchCount: hasMatch ? 0 : 1,
      };
    }

    if (options.multiline && options.isRegex) {
      const multilineMatches: Array<{ line: number; content: string }> = [];
      let match;
      regex.lastIndex = 0;

      while ((match = regex.exec(content)) !== null) {
        const matchStart = match.index;
        let lineNumber = 1;
        for (let i = 0; i < matchStart; i++) {
          if (content[i] === '\n') lineNumber++;
        }

        const matchedText = match[0];
        const matchLines = matchedText.split('\n');

        multilineMatches.push({
          line: lineNumber,
          content: matchLines.length > 1
            ? `${matchLines[0]}... (+${matchLines.length - 1} lines)`
            : matchedText.slice(0, 200)
        });

        if (regex.lastIndex === match.index) {
          regex.lastIndex++;
        }
      }

      return { matches: multilineMatches, matchCount: multilineMatches.length };
    }

    const matches: Array<{ line: number; content: string; context?: { before: string[]; after: string[] } }> = [];
    let matchCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      regex.lastIndex = 0;
      if (regex.test(line)) {
        matchCount++;

        const contextBefore: string[] = [];
        const contextAfter: string[] = [];

        if (options.contextBefore > 0) {
          for (let j = Math.max(0, i - options.contextBefore); j < i; j++) {
            const ctxLine = lines[j];
            if (ctxLine !== undefined) contextBefore.push(ctxLine);
          }
        }

        if (options.contextAfter > 0) {
          for (let j = i + 1; j <= Math.min(lines.length - 1, i + options.contextAfter); j++) {
            const ctxLine = lines[j];
            if (ctxLine !== undefined) contextAfter.push(ctxLine);
          }
        }

        const hasContext = contextBefore.length > 0 || contextAfter.length > 0;

        matches.push({
          line: i + 1,
          content: line,
          ...(hasContext && { context: { before: contextBefore, after: contextAfter } })
        });
      }
    }

    return { matches, matchCount };
  } catch (error) {
    return {
      matches: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

interface WalkResult {
  path: string;
  isDirectory: boolean;
  excluded?: boolean;
}

interface WalkOutput {
  results: WalkResult[];
  errors: string[];
}

async function walkDirectory(dir: string, filePattern?: string, includeHidden = false): Promise<WalkOutput> {
  const results: WalkResult[] = [];
  const errors: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const subDirPromises: Promise<WalkOutput>[] = [];

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) {
          results.push({ path: fullPath, isDirectory: true, excluded: true });
        } else {
          subDirPromises.push(walkDirectory(fullPath, filePattern, includeHidden));
        }
      } else {
        if (!filePattern || matchGlob(entry.name, filePattern)) {
          results.push({ path: fullPath, isDirectory: false });
        }
      }
    }

    if (subDirPromises.length > 0) {
      const subOutputs = await Promise.all(subDirPromises);
      for (const sub of subOutputs) {
        results.push(...sub.results);
        errors.push(...sub.errors);
      }
    }
  } catch (e) {
    errors.push(`${dir}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { results, errors };
}

async function listFilesRecursive(dirPath: string, workspace: string, filterPattern?: string, includeHidden = false): Promise<WalkOutput> {
  const fullPath = resolve(workspace, dirPath);
  const { results, errors } = await walkDirectory(fullPath, filterPattern, includeHidden);
  const separator = workspace.endsWith(sep) ? '' : sep;

  return {
    results: results.map(file => ({
      ...file,
      path: file.path.replace(workspace + separator, '')
    })),
    errors,
  };
}

async function findFilesByPattern(pattern: string, searchPath: string): Promise<string[]> {
  const results: string[] = [];

  const hasDoubleStar = pattern.includes('**');

  if (hasDoubleStar) {
    const { results: files } = await walkDirectory(searchPath, undefined, false);
    const separator = searchPath.endsWith(sep) ? '' : sep;
    const root = searchPath + separator;

    for (const file of files) {
      if (file.excluded) continue;

      let relativePath = file.path;
      if (file.path.startsWith(root)) {
        relativePath = file.path.slice(root.length);
      } else if (file.path.toLowerCase().startsWith(root.toLowerCase())) {
        relativePath = file.path.slice(root.length);
      }

      if (matchGlob(relativePath, pattern)) {
        results.push(relativePath);
      }
    }
  } else {
    const entries = await readdir(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (matchGlob(entry.name, pattern) && entry.isFile()) {
        results.push(entry.name);
      }
    }
  }

  return results;
}

async function generatePreview(toolName: string, args: Record<string, unknown>, workspace: string) {
  switch (toolName) {
    case 'write': {
      const path = args.path as string;
      const content = typeof args.content === 'string' ? args.content : '';
      const fullPath = resolve(workspace, path);

      if (!content || content.trim() === '') {
        return {
          title: `Write (${path})`,
          content: 'No new content in the file',
        };
      }

      let oldContent = '';
      try {
        oldContent = await readFile(fullPath, 'utf-8');
      } catch {
      }

      const diff = generateDiff(oldContent, content);
      const diffLines = formatDiffForDisplay(diff);

      return {
        title: `Write (${path})`,
        content: diffLines.join('\n'),
      };
    }

    case 'edit': {
      const path = args.path as string;
      const oldContent = args.old_content as string;
      const newContent = args.new_content as string;
      const occurrence = ((args.occurrence === null ? undefined : (args.occurrence as number | undefined)) ?? 1);

      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');

      const formattedLines: string[] = [];

      let startLineNumber = 1;
      try {
        const fullPath = resolve(workspace, path);
        const fileContent = await readFile(fullPath, 'utf-8');
        const fileLines = fileContent.split('\n');

        let occurrenceCount = 0;
        for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
          let match = true;
          for (let j = 0; j < oldLines.length; j++) {
            if (fileLines[i + j] !== oldLines[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            occurrenceCount++;
            if (occurrenceCount === occurrence) {
              startLineNumber = i + 1;
              break;
            }
          }
        }
      } catch {
      }

      for (let i = 0; i < oldLines.length; i++) {
        formattedLines.push(`-${String(startLineNumber + i).padStart(4)} | ${oldLines[i] ?? ''}`);
      }

      for (let i = 0; i < newLines.length; i++) {
        formattedLines.push(`+${String(startLineNumber + i).padStart(4)} | ${newLines[i] ?? ''}`);
      }

      return {
        title: `Edit (${path})`,
        content: formattedLines.join('\n'),
      };
    }

    case 'bash': {
      let command = args.command as string;

      const cleanCommand = command.replace(/\s+--timeout\s+\d+$/, '');

      return {
        title: `Command (${cleanCommand})`,
        content: cleanCommand,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function executeTool(toolName: string, args: Record<string, unknown>, options: ExecuteToolOptions = {}): Promise<ToolResult> {
  const workspace = process.cwd();
  const startTime = Date.now();
  const argsPreview = JSON.stringify(args).slice(0, 200);
  debugLog(`[tool] ${toolName} START args=${argsPreview}`);

  try {
    const readOnlyMode = process.env.MOSAIC_READONLY === '1';
    if (readOnlyMode) {
      const blockedTools = new Set(['write', 'edit', 'create_directory', 'bash']);
      if (blockedTools.has(toolName)) {
        return {
          success: false,
          error: `Read-only mode: tool "${toolName}" is disabled in Mosaic desktop.`,
        };
      }
    }

    const isBashTool = toolName === 'bash';
    const bashCommand = isBashTool ? (args.command as string) : '';
    const approvalsEnabled = shouldRequireApprovals();
    const localBashDecision = isBashTool ? getLocalBashDecision(bashCommand) : null;
    const bypassBashApproval = isBashTool && options.skipApproval === true;

    if (isBashTool) {
      if (localBashDecision === 'disallow') {
        return {
          success: false,
          error: `Command disallowed by local rules (.mosaic/rules.json): ${bashCommand}`,
        };
      }
      if (localBashDecision === 'auto-run') {
        debugLog(`[tool] bash auto-run by local rules: ${bashCommand}`);
      }
    }

    const bashNeedsApproval = isBashTool && !bypassBashApproval && !isSafeBashCommand(bashCommand) && approvalsEnabled
      && localBashDecision !== 'auto-run';
    const shouldTrackBashChanges = isBashTool && !bypassBashApproval && approvalsEnabled && shouldTrackBashFileChanges(bashCommand);
    let bashSnapshotBefore: WorkspaceReviewSnapshot | null = null;

    if (bashNeedsApproval) {
      const preview = await generatePreview(toolName, args, workspace);
      const approvalResult = await requestApproval('bash', args, preview);

      if (!approvalResult.approved) {
        if (approvalResult.customResponse) {
          const userMessage = `Operation cancelled by user`;
          const agentError = `OPERATION REJECTED BY USER with custom instructions: "${approvalResult.customResponse}"

The user provided specific instructions for what to do instead. Follow their instructions carefully.

DO NOT use the question tool since the user already provided clear instructions in their custom response.`;

          return {
            success: false,
            error: agentError,
            userMessage: userMessage,
          };
        }

        const operationDescription = `executing command: ${args.command}`;
        const suggestedOptions = 'Options could be: "Modify the command", "Use a different command", "Cancel operation"';

        const agentError = `OPERATION REJECTED BY USER: ${operationDescription}

REQUIRED ACTION: You MUST use the question tool immediately to ask the user why they rejected this and what they want to do instead.

Example question tool usage:
question(
  prompt: "Why did you reject ${operationDescription}?",
  options: [
    { label: "${suggestedOptions.split(', ')[0]?.replace('Options could be: ', '').replace(/"/g, '')}", value: "modify" },
    { label: "${suggestedOptions.split(', ')[1]?.replace(/"/g, '')}", value: "alternative" },
    { label: "${suggestedOptions.split(', ')[2]?.replace(/"/g, '')}", value: "cancel" }
  ]
)

DO NOT continue without using the question tool. DO NOT ask in plain text.`;

        const userMessage = `Operation cancelled by user`;

        return {
          success: false,
          error: agentError,
          userMessage: userMessage,
        };
      }
    }

    if (shouldTrackBashChanges) {
      try {
        bashSnapshotBefore = await captureWorkspaceReviewSnapshot(workspace);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog(`[tool] bash snapshot-before failed: ${message}`);
      }
    }

    switch (toolName) {
      case 'read': {
        const path = args.path as string;
        const startLine = args.start_line as number | undefined;
        const endLine = args.end_line as number | undefined;
        const fullPath = resolve(workspace, path);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const content = await readFile(fullPath, 'utf-8');

        if (startLine !== undefined || endLine !== undefined) {
          const lines = content.split('\n');
          const start = (startLine ?? 1) - 1;
          const end = endLine ?? lines.length;

          if (start < 0 || start >= lines.length) {
            return {
              success: false,
              error: `Start line ${startLine} is out of bounds (1-${lines.length})`
            };
          }

          const selectedLines = lines.slice(start, end);
          return {
            success: true,
            result: selectedLines.join('\n')
          };
        }

        return {
          success: true,
          result: content
        };
      }

      case 'write': {
        const path = args.path as string;
        let content = typeof args.content === 'string' ? args.content : '';
        if (content) content = content.trimEnd();
        const append = args.append === true;
        const fullPath = resolve(workspace, path);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        await mkdir(dirname(fullPath), { recursive: true });

        let oldContent = '';
        try {
          oldContent = await readFile(fullPath, 'utf-8');
        } catch {
        }

        if (append) {
          await appendFile(fullPath, content, 'utf-8');
          return {
            success: true,
            result: `Content appended successfully to: ${path}`
          };
        } else {
          await writeFile(fullPath, content, 'utf-8');

          if (!content || content.trim() === '') {
            return {
              success: true,
              result: `No new content in the file`,
            };
          }

          trackFileChange(path, oldContent, content);

          const diff = generateDiff(oldContent, content);
          const diffLines = formatDiffForDisplay(diff);

          if (shouldRequireApprovals()) {
            addPendingChange('write', path, oldContent, content, {
              title: `Write (${path})`,
              content: diffLines.join('\n'),
            });
          }

          return {
            success: true,
            result: `File written successfully: ${path}`,
            diff: diffLines,
          };
        }
      }

      case 'list': {
        const path = args.path as string;
        const recursive = args.recursive === null ? undefined : (args.recursive as boolean | undefined);
        const filter = args.filter === null ? undefined : (args.filter as string | undefined);
        const includeHidden = args.include_hidden === null ? undefined : (args.include_hidden as boolean | undefined);
        const fullPath = resolve(workspace, path);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        if (recursive) {
          const { results: files, errors: walkErrors } = await listFilesRecursive(path, workspace, filter, includeHidden);
          const fileStats = await Promise.all(
            files.map(async (file) => {
              if (file.excluded) {
                return {
                  path: file.path,
                  type: 'directory',
                  excluded: true
                };
              }
              const filePath = resolve(workspace, file.path);
              try {
                const stats = await stat(filePath);
                return {
                  path: file.path,
                  type: stats.isDirectory() ? 'directory' : 'file',
                  size: stats.size,
                };
              } catch {
                return {
                  path: file.path,
                  type: 'unknown',
                  error: 'access denied',
                };
              }
            })
          );
          const output: Record<string, unknown> = { files: fileStats };
          if (walkErrors.length > 0) {
            output.errors = walkErrors.slice(0, 10);
          }
          return {
            success: true,
            result: JSON.stringify(output, null, 2)
          };
        } else {
          const entries = await readdir(fullPath, { withFileTypes: true });
          let filteredEntries = entries;

          if (!includeHidden) {
            filteredEntries = filteredEntries.filter(entry => !entry.name.startsWith('.'));
          }

          if (filter) {
            const escapedFilter = filter
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.');
            const regex = new RegExp(`^${escapedFilter}$`, 'i');
            filteredEntries = filteredEntries.filter(entry => regex.test(entry.name));
          }

          const files = filteredEntries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            ...(entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name) ? { excluded: true } : {})
          }));

          return {
            success: true,
            result: JSON.stringify(files, null, 2)
          };
        }
      }

      case 'bash': {
        let command = args.command as string;
        let timeout = 30000;
        const flushBashTrackedChanges = async () => {
          if (!bashSnapshotBefore) return;
          try {
            const changedCount = await trackBashWorkspaceChanges(workspace, bashSnapshotBefore);
            if (changedCount > 0) {
              debugLog(`[tool] bash queued ${changedCount} filesystem change(s) for review`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            debugLog(`[tool] bash snapshot-after failed: ${message}`);
          }
        };

        const timeoutMatch = command.match(/\s+--timeout\s+(\d+)$/);
        if (timeoutMatch) {
          timeout = Math.min(parseInt(timeoutMatch[1] || '30000', 10), 90000);
          command = command.replace(/\s+--timeout\s+\d+$/, '');
        }

        const isWindows = process.platform === 'win32';

        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: workspace,
            timeout,
            ...(isWindows && { shell: 'powershell.exe' }),
            env: {
              ...process.env,
              CI: process.env.CI || '1',
              TERM: process.env.TERM || 'dumb',
              NO_COLOR: process.env.NO_COLOR || '1',
              npm_config_loglevel: process.env.npm_config_loglevel || 'silent',
              GIT_PAGER: process.env.GIT_PAGER || 'cat',
              PAGER: process.env.PAGER || 'cat',
            },
          });

          const output = normalizeCommandOutput((stdout || '') + (stderr || ''));
          await flushBashTrackedChanges();
          return {
            success: true,
            result: output || 'Command executed with no output'
          };
        } catch (error: unknown) {
          const execError = error as { stdout?: string; stderr?: string; message?: string; code?: number };
          const errorMessage = execError.message || String(error);

          if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            const partialOutput = normalizeCommandOutput((execError.stdout || '') + (execError.stderr || ''));
            const output = partialOutput
              ? `Command output (timed out after ${timeout}ms):\n${partialOutput}\n\n[Process continues running in background]`
              : `Command timed out after ${timeout}ms and produced no output.\n\n[Process may be running in background]`;

            await flushBashTrackedChanges();
            return {
              success: false,
              result: output
            };
          }

          const output = normalizeCommandOutput((execError.stdout || '') + (execError.stderr || ''));
          const exitCode = execError.code;
          const fullOutput = output
            ? `Command exited with code ${exitCode ?? 'unknown'}:\n${output}`
            : `Command failed: ${errorMessage}`;

          await flushBashTrackedChanges();
          return {
            success: false,
            result: fullOutput
          };
        }
      }

      case 'glob': {
        const pattern = args.pattern as string;
        const searchPath = (args.path === null ? undefined : (args.path as string | undefined)) || '.';
        const fullPath = resolve(workspace, searchPath);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const files = await findFilesByPattern(pattern, fullPath);

        return {
          success: true,
          result: JSON.stringify(files)
        };
      }

      case 'grep': {
        const { FILE_TYPE_EXTENSIONS } = await import('./grep.ts');

        const pattern = args.pattern === null ? undefined : (args.pattern as string | undefined);
        const fileType = args.file_type === null ? undefined : (args.file_type as string | undefined);
        const query = args.query as string;
        const searchPath = (args.path === null ? undefined : (args.path as string | undefined)) || '.';
        const caseSensitive = ((args.case_sensitive === null ? undefined : (args.case_sensitive as boolean | undefined)) ?? false);
        const isRegex = ((args.regex === null ? undefined : (args.regex as boolean | undefined)) ?? false);
        const wholeWord = ((args.whole_word === null ? undefined : (args.whole_word as boolean | undefined)) ?? false);
        const multiline = ((args.multiline === null ? undefined : (args.multiline as boolean | undefined)) ?? false);
        const context = ((args.context === null ? undefined : (args.context as number | undefined)) ?? 0);
        const contextBefore = ((args.context_before === null ? undefined : (args.context_before as number | undefined)) ?? context);
        const contextAfter = ((args.context_after === null ? undefined : (args.context_after as number | undefined)) ?? context);
        const maxResults = ((args.max_results === null ? undefined : (args.max_results as number | undefined)) ?? 500);
        const maxFileSize = ((args.max_file_size === null ? undefined : (args.max_file_size as number | undefined)) ?? DEFAULT_MAX_FILE_SIZE);
        const includeHidden = ((args.include_hidden === null ? undefined : (args.include_hidden as boolean | undefined)) ?? false);
        const excludePattern = args.exclude_pattern === null ? undefined : (args.exclude_pattern as string | undefined);
        const outputMode = ((args.output_mode === null ? undefined : (args.output_mode as string | undefined)) ?? 'matches') as 'matches' | 'files' | 'count';
        const invertMatch = ((args.invert_match === null ? undefined : (args.invert_match as boolean | undefined)) ?? false);

        const fullPath = resolve(workspace, searchPath);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        const testSearchOptions: SearchOptions = {
          caseSensitive,
          isRegex,
          wholeWord,
          multiline,
          contextBefore: 0,
          contextAfter: 0,
          maxFileSize: DEFAULT_MAX_FILE_SIZE,
          invertMatch: false,
        };
        const regexTest = buildSearchRegex(query, testSearchOptions);
        if (regexTest.error) {
          return {
            success: false,
            error: `Invalid search pattern: ${regexTest.error}`
          };
        }

        const normalizedFileType = typeof fileType === 'string' ? fileType.trim().toLowerCase() : undefined;
        const fileTypeParts = normalizedFileType
          ? normalizedFileType.split(',').map(p => p.trim()).filter(Boolean)
          : [];
        const resolvedExtensions = fileTypeParts.length > 0
          ? Array.from(new Set(fileTypeParts.flatMap((part) => {
            const mapped = FILE_TYPE_EXTENSIONS[part];
            if (mapped && mapped.length > 0) return mapped;
            if (part.startsWith('.')) return [part];
            return [`.${part}`];
          })))
          : undefined;

        const isPatternActualGlob = pattern && pattern !== '.' && pattern !== './' && (pattern.includes('*') || pattern.includes('?') || pattern.includes('['));

        let finalPattern: string;
        if (isPatternActualGlob) {
          finalPattern = pattern!.includes('**') ? pattern! : `**/${pattern}`;
        } else if (resolvedExtensions && resolvedExtensions.length === 1) {
          finalPattern = `**/*${resolvedExtensions[0]}`;
        } else {
          finalPattern = '**/*';
        }

        let allFiles = await findFilesByPattern(finalPattern, fullPath);

        if (!includeHidden) {
          allFiles = allFiles.filter(f => !f.split('/').some(part => part.startsWith('.')));
        }

        if (resolvedExtensions && !isPatternActualGlob) {
          allFiles = allFiles.filter(f => resolvedExtensions.some(ext => f.toLowerCase().endsWith(ext)));
        }

        if (excludePattern) {
          allFiles = allFiles.filter(f => !matchGlob(f, excludePattern));
        }

        const searchOptions: SearchOptions = {
          caseSensitive,
          isRegex,
          wholeWord,
          multiline,
          contextBefore,
          contextAfter,
          maxFileSize,
          invertMatch,
        };

        type MatchType = { line: number; content: string; context?: { before: string[]; after: string[] } };
        const results: Array<{ file: string; matches: MatchType[]; count?: number }> = [];
        const skippedFiles: Array<{ file: string; reason: string }> = [];
        let totalResults = 0;
        let totalMatchCount = 0;

        const BATCH_SIZE = 15;
        for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
          if (!invertMatch && totalResults >= maxResults) break;

          const batch = allFiles.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (file) => {
              const filePath = resolve(fullPath, file);
              const searchResult = await searchInFile(filePath, query, searchOptions);
              return {
                file: join(searchPath, file),
                matches: searchResult.matches,
                matchCount: searchResult.matchCount ?? searchResult.matches.length,
                skipped: searchResult.skipped,
                skipReason: searchResult.skipReason,
              };
            })
          );

          for (const { file, matches, matchCount, skipped, skipReason } of batchResults) {
            if (skipped && skipReason) {
              skippedFiles.push({ file, reason: skipReason });
              continue;
            }

            if (invertMatch) {
              if (matchCount === 1) {
                results.push({ file, matches: [], count: 1 });
                totalResults++;
              }
              continue;
            }

            if (matches.length > 0 || matchCount > 0) {
              totalMatchCount += matchCount;

              if (outputMode === 'files') {
                results.push({ file, matches: [] });
                totalResults++;
              } else if (outputMode === 'count') {
                results.push({ file, matches: [], count: matchCount });
                totalResults++;
              } else {
                const remainingSlots = maxResults - totalResults;
                const matchesToInclude = matches.slice(0, remainingSlots);
                results.push({ file, matches: matchesToInclude, count: matchCount });
                totalResults += matchesToInclude.length;
              }
            }
          }
        }

        let formattedResult: string;

        const skippedDetails = skippedFiles.length > 0
          ? skippedFiles.slice(0, 5).map(s => ({ file: s.file, reason: s.reason }))
          : undefined;

        if (outputMode === 'files') {
          const filesOnly = results.map(r => r.file);
          const summary = {
            files_found: filesOnly.length,
            files: filesOnly,
            ...(skippedFiles.length > 0 && { skipped: skippedFiles.length, skipped_details: skippedDetails })
          };
          formattedResult = JSON.stringify(summary, null, 2);
        } else if (outputMode === 'count') {
          const counts = results.map(r => ({ file: r.file, count: r.count ?? 0 }));
          const summary = {
            total_matches: totalMatchCount,
            files_with_matches: counts.length,
            counts,
            ...(skippedFiles.length > 0 && { skipped: skippedFiles.length, skipped_details: skippedDetails })
          };
          formattedResult = JSON.stringify(summary, null, 2);
        } else {
          const summary = {
            total_matches: totalMatchCount,
            files_searched: allFiles.length,
            files_with_matches: results.length,
            ...(skippedFiles.length > 0 && { skipped_files: skippedFiles.length, skipped_details: skippedDetails }),
            ...(totalResults >= maxResults && { truncated: true, max_results: maxResults }),
            results: results.map(r => ({
              file: r.file,
              match_count: r.count ?? r.matches.length,
              matches: r.matches.map(m => {
                if (m.context && (m.context.before.length > 0 || m.context.after.length > 0)) {
                  return {
                    line: m.line,
                    content: m.content,
                    context: m.context
                  };
                }
                return { line: m.line, content: m.content };
              })
            }))
          };
          formattedResult = JSON.stringify(summary, null, 2);
        }

        return {
          success: true,
          result: formattedResult
        };
      }

      case 'edit': {
        const path = args.path as string;
        const oldContent = args.old_content as string;
        let newContent = args.new_content as string;
        if (newContent) newContent = newContent.trimEnd();
        const occurrence = ((args.occurrence === null ? undefined : (args.occurrence as number | undefined)) ?? 1);
        const fullPath = resolve(workspace, path);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        await mkdir(dirname(fullPath), { recursive: true });

        let content = '';
        try {
          content = await readFile(fullPath, 'utf-8');
        } catch {
          content = '';
        }

        if (oldContent === '' && content === '') {
          await writeFile(fullPath, newContent, 'utf-8');

          trackFileCreated(path, newContent);

          const diff = generateDiff('', newContent);
          const diffLines = formatDiffForDisplay(diff);

          if (shouldRequireApprovals()) {
            addPendingChange('write', path, '', newContent, {
              title: `Create (${path})`,
              content: diffLines.join('\n'),
            });
          }

          return {
            success: true,
            result: `File created and edited successfully: ${path}`,
            diff: diffLines,
          };
        }

        const parts = content.split(oldContent);

        if (parts.length < occurrence + 1) {
          return {
            success: false,
            error: `Could not find occurrence ${occurrence} of the specified content`
          };
        }

        const before = parts.slice(0, occurrence).join(oldContent);
        const after = parts.slice(occurrence).join(oldContent);
        const updatedContent = before + newContent + after;

        await writeFile(fullPath, updatedContent, 'utf-8');

        trackFileChange(path, content, updatedContent);

        const diff = generateDiff(content, updatedContent);
        const diffLines = formatDiffForDisplay(diff);

        if (shouldRequireApprovals()) {
          addPendingChange('edit', path, content, updatedContent, {
            title: `Edit (${path})`,
            content: diffLines.join('\n'),
          });
        }

        return {
          success: true,
          result: `File edited successfully: ${path}`,
          diff: diffLines,
        };
      }

      case 'create_directory': {
        const path = args.path as string;
        const extension = extname(path || '');
        const knownFileExtensions = new Set([
          '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
          '.py', '.go', '.java', '.kt', '.rb', '.php', '.rs',
          '.c', '.cc', '.cpp', '.h', '.hpp',
          '.json', '.yaml', '.yml', '.toml', '.ini',
          '.md', '.txt', '.env',
          '.sh', '.bat', '.ps1',
          '.html', '.css', '.scss', '.less',
        ]);
        if (extension && knownFileExtensions.has(extension.toLowerCase())) {
          return {
            success: false,
            error: `Refusing to create a directory at "${path}" because it looks like a file path. Use write with path "${path}" to create a file instead.`
          };
        }
        const fullPath = resolve(workspace, path);

        if (!await validatePath(fullPath, workspace)) {
          return {
            success: false,
            error: 'Access denied: path is outside workspace'
          };
        }

        await mkdir(fullPath, { recursive: true });

        return {
          success: true,
          result: `Directory created: ${path}`
        };
      }

      case 'fetch': {
        const url = args.url as string;
        const maxLength = (args.max_length as number | undefined) ?? DEFAULT_FETCH_MAX_LENGTH;
        const startIndex = (args.start_index as number | undefined) ?? 0;
        const raw = (args.raw as boolean | undefined) ?? false;
        const timeout = (args.timeout as number | undefined) ?? DEFAULT_FETCH_TIMEOUT;

        try {
          new URL(url);
        } catch {
          return {
            success: false,
            error: `Invalid URL: ${url}`,
          };
        }

        try {
          let fetchResult = await fetchUrlContent(url, { raw, timeout });
          let { content, contentType, title, isSPA, status, statusText } = fetchResult;

          if (isSPA && !raw) {
            const rawResult = await fetchUrlContent(url, { raw: true, timeout });
            content = rawResult.content;
            contentType = rawResult.contentType;
            title = rawResult.title;
            status = rawResult.status;
            statusText = rawResult.statusText;
            isSPA = false;
          }

          const totalLength = content.length;

          if (startIndex >= totalLength) {
            return {
              success: false,
              error: `Start index ${startIndex} exceeds content length ${totalLength}`,
            };
          }

          const extractedContent = content.slice(startIndex, startIndex + maxLength);
          const truncated = startIndex + maxLength < totalLength;
          const nextStartIndex = truncated ? startIndex + maxLength : undefined;

          const parts: string[] = [];

          if (title) {
            parts.push(`# ${title}\n`);
          }

          parts.push(`**URL:** ${url}`);
          parts.push(`**Status:** ${status} ${statusText}`);
          parts.push(`**Content-Type:** ${contentType}`);
          parts.push(`**Length:** ${extractedContent.length} / ${totalLength} characters`);

          if (fetchResult.isSPA) {
            parts.push(`**Note:** SPA detected (React/Vue/Angular). Showing raw HTML source.`);
          }

          if (truncated && nextStartIndex !== undefined) {
            parts.push(`**Status:** Content truncated. Use start_index=${nextStartIndex} to continue reading.`);
          }

          parts.push('\n---\n');
          parts.push(extractedContent);

          if (truncated && nextStartIndex !== undefined) {
            parts.push(`\n\n---\n*Content truncated at ${extractedContent.length} characters. Call fetch again with start_index=${nextStartIndex} to continue reading.*`);
          }

          return {
            success: true,
            result: parts.join('\n'),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (message.includes('abort')) {
            return {
              success: false,
              error: `Request timed out after ${timeout}ms`,
            };
          }

          return {
            success: false,
            error: `Failed to fetch ${url}: ${message}`,
          };
        }
      }

      default: {
        const duration = Date.now() - startTime;
        debugLog(`[tool] ${toolName} ERROR unknown tool (${duration}ms)`);
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
      }
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
    debugLog(`[tool] ${toolName} ERROR ${errorMsg.slice(0, 100)} (${duration}ms)`);
    return {
      success: false,
      error: errorMsg
    };
  }
}
