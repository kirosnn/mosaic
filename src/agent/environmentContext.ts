import { existsSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

const MACHINE_ACTION_PATTERNS = [
  /\binstall\b/i,
  /\bconfigure\b/i,
  /\bconfigurer\b/i,
  /\bsetup\b/i,
  /\bset up\b/i,
  /\bconnect\b/i,
  /\bbrancher\b/i,
  /\bintegrat(?:e|ion)\b/i,
  /\binspect\b/i,
  /\binspecter\b/i,
  /\bfind\b/i,
  /\btrouve?r\b/i,
  /\blocat(?:e|ion)\b/i,
  /\bopen\b/i,
  /\bouvrir\b/i,
];

const MACHINE_TARGET_PATTERNS = [
  /\bmcp(?:\s+server)?\b/i,
  /\bserver\b/i,
  /\bintegration\b/i,
  /\bplugin\b/i,
  /\bextension\b/i,
  /\bapp(?:lication)?\b/i,
  /\bsoftware\b/i,
  /\beditor\b/i,
  /\bide\b/i,
  /\bnotes?\b/i,
  /\bvault\b/i,
  /\bfolder\b/i,
  /\bdocuments?\b/i,
  /\bsettings?\b/i,
  /\bconfig(?:uration)?\b/i,
  /\bpreferences?\b/i,
  /\bprofile\b/i,
  /\blocal\b/i,
  /\bmachine\b/i,
  /\bsystem\b/i,
  /\bdesktop\b/i,
];

const STRONG_MACHINE_PATTERNS = [
  /\bmcp(?:\s+server)?\b/i,
  /\bon (?:my|this) machine\b/i,
  /\boutside (?:the )?(?:workspace|repo|project)\b/i,
  /\bappdata\b/i,
  /\b%appdata%\b/i,
  /\b%localappdata%\b/i,
  /\b~[\\/]/,
  /\b[a-z]:\\/i,
  /\/(?:users|home|applications|etc|var)\//i,
];

const REPO_REFERENCE_PATTERNS = [
  /\brepo(?:sitory)?\b/i,
  /\bworkspace\b/i,
  /\bproject\b/i,
  /\bcodebase\b/i,
  /\bsrc\b/i,
  /\bpackage\.json\b/i,
  /\btsconfig\b/i,
  /\btests?\b/i,
  /\bbranch\b/i,
  /\bcommit\b/i,
  /\bdiff\b/i,
];

const COMMON_STOP_WORDS = new Set([
  'a', 'an', 'and', 'app', 'application', 'assistant', 'connect', 'configure', 'config',
  'create', 'desktop', 'documents', 'edit', 'editor', 'file', 'folder', 'for', 'from',
  'install', 'integration', 'local', 'machine', 'mosaic', 'notes', 'open', 'profile',
  'server', 'settings', 'software', 'system', 'the', 'this', 'tool', 'update', 'use',
  'with', 'workspace',
]);

export type LaunchScopeKind = 'project' | 'home' | 'desktop' | 'documents' | 'downloads' | 'root' | 'folder';

export interface LaunchScope {
  kind: LaunchScopeKind;
  label: string;
  broad: boolean;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function uniqueLimited(values: string[], maxItems: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = normalizeWhitespace(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isLikelyProjectFolder(cwd: string): boolean {
  const markers = [
    'package.json',
    'tsconfig.json',
    'Cargo.toml',
    'pyproject.toml',
    'go.mod',
    '.git',
    'AGENTS.md',
  ];
  return markers.some((marker) => existsSync(join(cwd, marker)));
}

export function detectLaunchScope(cwd: string = process.cwd()): LaunchScope {
  const absolute = resolve(cwd);
  const home = resolve(homedir());
  const lower = absolute.toLowerCase();
  const lowerHome = home.toLowerCase();
  const name = basename(absolute).toLowerCase();

  if (lower === lowerHome) {
    return { kind: 'home', label: 'home directory', broad: true };
  }
  if (name === 'desktop') {
    return { kind: 'desktop', label: 'desktop directory', broad: true };
  }
  if (name === 'documents') {
    return { kind: 'documents', label: 'documents directory', broad: true };
  }
  if (name === 'downloads') {
    return { kind: 'downloads', label: 'downloads directory', broad: true };
  }
  if (dirname(absolute) === absolute) {
    return { kind: 'root', label: 'filesystem root', broad: true };
  }
  if (isLikelyProjectFolder(absolute)) {
    return { kind: 'project', label: 'project-like directory', broad: false };
  }
  return { kind: 'folder', label: 'generic folder', broad: false };
}

function extractQuotedTargets(text: string): string[] {
  const matches = [...text.matchAll(/["'`](.{2,60}?)["'`]/g)];
  return matches.map((match) => match[1] || '').filter(Boolean);
}

function extractNamedTargets(text: string): string[] {
  const candidates: string[] = [];
  const normalized = normalizeWhitespace(text);
  candidates.push(...extractQuotedTargets(normalized));

  const titleCase = normalized.match(/\b(?:[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,2}|[A-Z]{2,10})\b/g) ?? [];
  candidates.push(...titleCase);

  const keywordAnchors = [...normalized.matchAll(/\b(?:for|with|to|in)\s+([A-Za-z0-9_.-]{2,40}(?:\s+[A-Za-z0-9_.-]{2,40}){0,2})/gi)];
  for (const match of keywordAnchors) {
    candidates.push(match[1] || '');
  }

  return uniqueLimited(
    candidates.filter((candidate) => {
      const compact = candidate.trim();
      if (!compact) return false;
      return !COMMON_STOP_WORDS.has(compact.toLowerCase());
    }),
    4,
  );
}

function inferCandidateFileNames(text: string): string[] {
  const lower = text.toLowerCase();
  const candidates = ['settings.json', 'config.json', 'config.toml'];

  if (lower.includes('mcp')) {
    candidates.unshift('mcp.json', 'mcp.jsonc');
  }
  if (lower.includes('profile')) {
    candidates.push('profiles.json', 'profile.json');
  }
  if (lower.includes('extension') || lower.includes('plugin')) {
    candidates.push('extensions.json', 'plugins.json');
  }
  if (lower.includes('preferences')) {
    candidates.push('preferences.json');
  }

  return uniqueLimited(candidates, 6);
}

function getPlatformConfigRoots(): string[] {
  if (process.platform === 'win32') {
    return [
      '%APPDATA%',
      '%LOCALAPPDATA%',
      '%USERPROFILE%\\.config',
      '%USERPROFILE%\\.codex',
      '%USERPROFILE%\\.mosaic',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '~/Library/Application Support',
      '~/Library/Preferences',
      '~/.config',
      '~/.codex',
      '~/.mosaic',
    ];
  }
  return [
    '~/.config',
    '~/.local/share',
    '~/.codex',
    '~/.mosaic',
  ];
}

function inferCandidatePaths(targets: string[]): string[] {
  const roots = getPlatformConfigRoots();
  const values: string[] = [];
  const separator = process.platform === 'win32' ? '\\' : '/';

  for (const root of roots.slice(0, 3)) {
    values.push(root);
    for (const target of targets) {
      const dashed = target.replace(/\s+/g, '-');
      const compact = target.replace(/\s+/g, '');
      values.push(`${root}${separator}${target}`);
      values.push(`${root}${separator}${compact}`);
      values.push(`${root}${separator}${dashed}`);
    }
  }

  return uniqueLimited(values, 6);
}

function inferEarlyQuestions(text: string, targets: string[]): string[] {
  const lower = text.toLowerCase();
  const questions: string[] = [];

  if ((lower.includes('vault') || lower.includes('notes') || lower.includes('folder') || lower.includes('documents'))
    && !STRONG_MACHINE_PATTERNS.some((pattern) => pattern.test(text))) {
    questions.push('Ask for the exact local folder, vault, or document path before searching broadly.');
  }
  if ((lower.includes('profile') || lower.includes('editor') || lower.includes('browser')) && targets.length === 0) {
    questions.push('Ask which app, profile, or account should be targeted.');
  }
  if (lower.includes('configure') || lower.includes('setup') || lower.includes('install')) {
    questions.push('Ask whether to create a new config or update an existing one when that changes the search path.');
  }
  if (lower.includes('mcp') && targets.length === 0) {
    questions.push('Ask which local app or dataset should be connected to the MCP integration.');
  }

  return uniqueLimited(questions, 3);
}

export function isEnvironmentConfigIntent(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;

  const hasAction = MACHINE_ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasTarget = MACHINE_TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasStrongScope = STRONG_MACHINE_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasRepoScope = REPO_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));

  if (hasStrongScope && hasTarget) {
    return true;
  }
  if (!hasAction || !hasTarget) {
    return false;
  }
  if (hasRepoScope && !hasStrongScope) {
    return false;
  }
  return true;
}

export function buildEnvironmentContextSummary(request: string, cwd: string = process.cwd()): string {
  const launchScope = detectLaunchScope(cwd);
  const targets = extractNamedTargets(request);
  const candidatePaths = inferCandidatePaths(targets);
  const candidateFiles = inferCandidateFileNames(request);
  const earlyQuestions = inferEarlyQuestions(request, targets);

  const lines: string[] = [
    'LOCAL MACHINE TASK SUMMARY',
    `- Launch directory: ${cwd} (${launchScope.label}${launchScope.broad ? ', broad scope' : ''})`,
    '- Repo scan: skipped for this task mode unless the user later makes the repository explicitly relevant.',
    `- Preferred config roots: ${getPlatformConfigRoots().join(' | ')}`,
  ];

  if (targets.length > 0) {
    lines.push(`- Inferred targets: ${targets.join(', ')}`);
  }
  if (candidatePaths.length > 0) {
    lines.push(`- High-confidence candidate paths: ${candidatePaths.join(' | ')}`);
  }
  if (candidateFiles.length > 0) {
    lines.push(`- Exact filenames to check first: ${candidateFiles.join(', ')}`);
  }
  if (earlyQuestions.length > 0) {
    lines.push(`- Ask early if missing: ${earlyQuestions.join(' | ')}`);
  }

  return truncateText(lines.join('\n'), 1400);
}
