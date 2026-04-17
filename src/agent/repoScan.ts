import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import { debugLog } from '../utils/debug';
import { walkWorkspaceSync } from './repoDiscovery';

export interface RepositoryCommandHints {
  install: string[];
  dev: string[];
  build: string[];
  test: string[];
  lint: string[];
}

export interface RepositoryRootSummary {
  path: string;
  markers: string[];
  manifests: string[];
  entrypoints: string[];
  topLevelDirectories: string[];
}

export interface RepositorySummary {
  workspaceRoot: string;
  generatedAt: number;
  projectRoots: RepositoryRootSummary[];
  manifests: string[];
  dependencyManifests: string[];
  architectureFiles: string[];
  importantFiles: string[];
  entrypoints: string[];
  topLevelDirectories: string[];
  commands: RepositoryCommandHints;
  cacheHit: boolean;
}

interface CachedRepositorySummary {
  summary: RepositorySummary;
  signature: string;
}

const MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pipfile',
  'gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'global.json',
]);

const ARCHITECTURE_FILE_NAMES = new Set([
  'tsconfig.json',
  'tsconfig.base.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'turbo.json',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'mosaic.md',
  'agents.md',
  'readme.md',
]);

const ENTRYPOINT_BASENAMES = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'main.ts',
  'main.tsx',
  'main.js',
  'main.jsx',
  'app.ts',
  'app.tsx',
  'app.js',
  'app.jsx',
  'server.ts',
  'server.js',
  'program.cs',
  'main.rs',
  'main.py',
  'manage.py',
  'page.tsx',
  'page.jsx',
]);

const cache = new Map<string, CachedRepositorySummary>();

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function isManifest(path: string): boolean {
  const lower = basename(path).toLowerCase();
  if (MANIFEST_NAMES.has(lower)) return true;
  return lower.endsWith('.csproj') || lower.endsWith('.sln');
}

function isArchitectureFile(path: string): boolean {
  const lower = basename(path).toLowerCase();
  return ARCHITECTURE_FILE_NAMES.has(lower) || lower.endsWith('.config.ts') || lower.endsWith('.config.js');
}

function isEntrypoint(path: string): boolean {
  const lower = basename(path).toLowerCase();
  if (ENTRYPOINT_BASENAMES.has(lower)) return true;
  return /(?:^|\/)(app|src)\/(index|main|server)\.(?:ts|tsx|js|jsx|rs|py)$/i.test(normalizePath(path));
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function createEmptyCommands(): RepositoryCommandHints {
  return {
    install: [],
    dev: [],
    build: [],
    test: [],
    lint: [],
  };
}

function addPackageJsonCommands(commands: RepositoryCommandHints, packageJsonPath: string, workspaceRoot: string): void {
  try {
    const raw = readFileSync(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts ?? {};
    const relativeDir = normalizePath(relative(workspaceRoot, dirname(packageJsonPath)) || '.');
    const prefix = relativeDir === '.' ? '' : `cd ${relativeDir} && `;
    const addScript = (name: string, target: keyof RepositoryCommandHints) => {
      if (!scripts[name]) return;
      pushUnique(commands[target], `${prefix}bun run ${name}`);
      pushUnique(commands[target], `${prefix}npm run ${name}`);
    };

    addScript('dev', 'dev');
    addScript('start', 'dev');
    addScript('build', 'build');
    addScript('test', 'test');
    addScript('lint', 'lint');

    if (commands.install.length === 0) {
      pushUnique(commands.install, `${prefix}bun install`);
      pushUnique(commands.install, `${prefix}npm install`);
    }
  } catch {}
}

function addManifestCommands(commands: RepositoryCommandHints, manifests: string[], workspaceRoot: string): void {
  for (const manifest of manifests) {
    const lower = basename(manifest).toLowerCase();
    if (lower === 'package.json') {
      addPackageJsonCommands(commands, manifest, workspaceRoot);
      continue;
    }
    if (lower === 'cargo.toml') {
      pushUnique(commands.build, 'cargo build');
      pushUnique(commands.test, 'cargo test');
      continue;
    }
    if (lower === 'go.mod') {
      pushUnique(commands.build, 'go build ./...');
      pushUnique(commands.test, 'go test ./...');
      continue;
    }
    if (lower === 'pyproject.toml' || lower === 'requirements.txt') {
      pushUnique(commands.test, 'pytest');
      continue;
    }
    if (lower.endsWith('.sln') || lower.endsWith('.csproj')) {
      pushUnique(commands.build, 'dotnet build');
      pushUnique(commands.test, 'dotnet test');
    }
  }
}

function computeWorkspaceSignature(workspaceRoot: string): string {
  const absoluteRoot = resolve(workspaceRoot);
  const entries = readdirSync(absoluteRoot, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const parts: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(absoluteRoot, entry.name);
    try {
      const info = statSync(fullPath);
      parts.push(`${entry.name}:${info.mtimeMs}:${info.size}:${entry.isDirectory() ? 'd' : 'f'}`);
    } catch {
      parts.push(`${entry.name}:missing`);
    }
  }

  return parts.join('|');
}

function deriveProjectRoots(
  workspaceRoot: string,
  manifests: string[],
  directories: string[],
  entrypoints: string[],
): RepositoryRootSummary[] {
  const roots = new Map<string, RepositoryRootSummary>();

  const ensureRoot = (path: string): RepositoryRootSummary => {
    const normalized = normalizePath(path || '.');
    const existing = roots.get(normalized);
    if (existing) return existing;
    const created: RepositoryRootSummary = {
      path: normalized,
      markers: [],
      manifests: [],
      entrypoints: [],
      topLevelDirectories: [],
    };
    roots.set(normalized, created);
    return created;
  };

  for (const manifest of manifests) {
    const relativeDir = normalizePath(relative(workspaceRoot, dirname(resolve(workspaceRoot, manifest))) || '.');
    const root = ensureRoot(relativeDir);
    pushUnique(root.manifests, manifest);
    const marker = basename(manifest);
    if (isManifest(marker)) {
      pushUnique(root.markers, marker);
    }
  }

  for (const directory of directories) {
    if (basename(directory) !== '.git') continue;
    const projectDir = normalizePath(dirname(directory));
    const root = ensureRoot(projectDir);
    pushUnique(root.markers, '.git');
  }

  for (const entrypoint of entrypoints) {
    const normalized = normalizePath(entrypoint);
    const segments = normalized.split('/');
    const rootPath = segments.length > 2 ? segments[0]! : '.';
    const root = ensureRoot(rootPath);
    pushUnique(root.entrypoints, entrypoint);
  }

  for (const directory of directories) {
    const normalized = normalizePath(directory);
    const segments = normalized.split('/');
    if (segments.length !== 1) continue;
    const root = ensureRoot('.');
    pushUnique(root.topLevelDirectories, normalized);
  }

  return [...roots.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function scanRepository(workspaceRoot: string = process.cwd()): RepositorySummary {
  const absoluteRoot = resolve(workspaceRoot);
  const signature = computeWorkspaceSignature(absoluteRoot);
  const cached = cache.get(absoluteRoot);

  if (cached && cached.signature === signature) {
    return {
      ...cached.summary,
      cacheHit: true,
    };
  }

  const rootEntries = readdirSync(absoluteRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const walked = walkWorkspaceSync(absoluteRoot, '.', {
    includeFiles: true,
    includeDirectories: true,
    includeHidden: true,
    maxDepth: 4,
    relativeTo: 'workspace',
  });

  const files = walked.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path);
  const directories = walked.entries.filter((entry) => entry.type === 'directory').map((entry) => entry.path);
  const manifests = files.filter((path) => isManifest(path)).sort((a, b) => a.localeCompare(b));
  const dependencyManifests = manifests.filter((path) => {
    const lower = basename(path).toLowerCase();
    return lower === 'package.json' || lower === 'cargo.toml' || lower === 'go.mod' || lower === 'pyproject.toml' || lower.endsWith('.csproj');
  });
  const architectureFiles = files.filter((path) => isArchitectureFile(path)).sort((a, b) => a.localeCompare(b));
  const entrypoints = files.filter((path) => isEntrypoint(path)).sort((a, b) => a.localeCompare(b)).slice(0, 20);
  const importantFiles = [...new Set([...manifests, ...architectureFiles, ...entrypoints])].slice(0, 40);
  const topLevelDirectories = directories
    .filter((path) => !path.includes('/') && !basename(path).startsWith('.'))
    .sort((a, b) => a.localeCompare(b));
  const commands = createEmptyCommands();
  addManifestCommands(commands, manifests.map((path) => resolve(absoluteRoot, path)), absoluteRoot);
  const projectRoots = deriveProjectRoots(absoluteRoot, manifests, directories, entrypoints);

  const summary: RepositorySummary = {
    workspaceRoot: absoluteRoot,
    generatedAt: Date.now(),
    projectRoots,
    manifests,
    dependencyManifests,
    architectureFiles,
    importantFiles,
    entrypoints,
    topLevelDirectories,
    commands,
    cacheHit: false,
  };

  cache.set(absoluteRoot, { summary, signature });
  debugLog(
    `[repo-scan] workspace=${absoluteRoot} cacheHit=false projectRoots=${projectRoots.length} manifests=${manifests.length} entrypoints=${entrypoints.length} topLevelDirs=${topLevelDirectories.length} rootEntries=${rootEntries.length}`,
  );
  return summary;
}

export function clearRepositoryScanCache(): void {
  cache.clear();
}

export function formatRepositorySummary(summary: RepositorySummary, maxChars = 1600): string {
  const lines: string[] = [];
  lines.push(`Workspace root: ${normalizePath(summary.workspaceRoot)}`);
  if (summary.projectRoots.length > 0) {
    lines.push(`Project roots: ${summary.projectRoots.map((root) => root.path).join(', ')}`);
  }
  if (summary.topLevelDirectories.length > 0) {
    lines.push(`Top-level directories: ${summary.topLevelDirectories.slice(0, 10).join(', ')}`);
  }
  if (summary.manifests.length > 0) {
    lines.push(`Manifests: ${summary.manifests.slice(0, 12).join(', ')}`);
  }
  if (summary.entrypoints.length > 0) {
    lines.push(`Entrypoints: ${summary.entrypoints.slice(0, 10).join(', ')}`);
  }

  const commandSections: Array<[keyof RepositoryCommandHints, string]> = [
    ['install', 'Install'],
    ['dev', 'Dev'],
    ['build', 'Build'],
    ['test', 'Test'],
    ['lint', 'Lint'],
  ];

  for (const [key, label] of commandSections) {
    const values = summary.commands[key];
    if (values.length === 0) continue;
    lines.push(`${label}: ${values.slice(0, 3).join(' | ')}`);
  }

  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function formatArchitectureSummary(summary: RepositorySummary, maxChars = 2400): string {
  const lines: string[] = [];
  lines.push(`Workspace: ${normalizePath(summary.workspaceRoot)}`);

  const primaryRoot = summary.projectRoots.find((r) => r.path === '.') ?? summary.projectRoots[0];
  if (primaryRoot) {
    lines.push(`Primary project: ${primaryRoot.path}`);
    if (primaryRoot.manifests.length > 0) {
      lines.push(`  Manifests: ${primaryRoot.manifests.slice(0, 5).join(', ')}`);
    }
    if (primaryRoot.entrypoints.length > 0) {
      lines.push(`  Entrypoints: ${primaryRoot.entrypoints.slice(0, 5).join(', ')}`);
    }
  }

  const secondaryRoots = summary.projectRoots.filter((r) => r !== primaryRoot);
  if (secondaryRoots.length > 0) {
    lines.push(`Secondary projects: ${secondaryRoots.map((r) => r.path).slice(0, 6).join(', ')}`);
  }

  const keyManifests = summary.dependencyManifests.slice(0, 8);
  if (keyManifests.length > 0) {
    lines.push(`Key manifests: ${keyManifests.join(', ')}`);
  }

  const configFiles = summary.architectureFiles
    .filter((f) => {
      const lower = basename(f).toLowerCase();
      return lower !== 'readme.md' && lower !== 'agents.md' && lower !== 'mosaic.md';
    })
    .slice(0, 8);
  if (configFiles.length > 0) {
    lines.push(`Config files: ${configFiles.join(', ')}`);
  }

  if (summary.entrypoints.length > 0) {
    lines.push(`Entrypoints: ${summary.entrypoints.slice(0, 8).join(', ')}`);
  }

  const topDirs = summary.topLevelDirectories.slice(0, 12);
  if (topDirs.length > 0) {
    lines.push(`Top-level dirs: ${topDirs.join(', ')}`);
  }

  const commandSections: Array<[keyof RepositoryCommandHints, string]> = [
    ['dev', 'Dev'],
    ['build', 'Build'],
    ['test', 'Test'],
  ];
  for (const [key, label] of commandSections) {
    const values = summary.commands[key];
    if (values.length > 0) lines.push(`${label}: ${values[0]}`);
  }

  lines.push('Do not recursively list the workspace. Use this summary as the starting point for exploration.');

  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function hasRepositoryGuidanceFile(workspaceRoot: string = process.cwd()): boolean {
  const absoluteRoot = resolve(workspaceRoot);
  return existsSync(resolve(absoluteRoot, 'AGENTS.md'));
}
