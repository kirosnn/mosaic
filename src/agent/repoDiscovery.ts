import { readdirSync } from 'fs';
import { readdir, realpath, stat } from 'fs/promises';
import { basename, relative, resolve, sep } from 'path';

export const EXCLUDED_DISCOVERY_DIRECTORIES = new Set([
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

export interface DiscoveryEntry {
  path: string;
  absolutePath: string;
  name: string;
  type: 'file' | 'directory';
  depth: number;
  excluded?: boolean;
}

export interface DiscoveryWalkResult {
  entries: DiscoveryEntry[];
  errors: string[];
}

export interface DiscoveryWalkOptions {
  includeHidden?: boolean;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  filter?: string;
  maxDepth?: number;
  relativeTo?: 'workspace' | 'start';
}

const globPatternCache = new Map<string, RegExp>();

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function matchGlob(path: string, pattern: string): boolean {
  let regex = globPatternCache.get(pattern);

  if (!regex) {
    const normalizedPattern = normalizePath(pattern);
    const variants = normalizedPattern.startsWith('**/')
      ? [normalizedPattern, normalizedPattern.slice(3)]
      : [normalizedPattern];
    const compiled = variants.map((variant) => {
      let regexPattern = variant.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
      regexPattern = regexPattern
        .replace(/\\\*\\\*\\\//g, '(?:(?:[^/]+/)*)')
        .replace(/\\\/\*\\\*$/g, '(?:/.*)?')
        .replace(/\\\*\\\*/g, '.*')
        .replace(/\\\*/g, '[^/]*')
        .replace(/\\\?/g, '[^/]');
      return regexPattern;
    });

    regex = new RegExp(`^(?:${compiled.join('|')})$`, 'i');
    globPatternCache.set(pattern, regex);

    if (globPatternCache.size > 100) {
      const firstKey = globPatternCache.keys().next().value;
      if (typeof firstKey === 'string') {
        globPatternCache.delete(firstKey);
      }
    }
  }

  return regex.test(normalizePath(path));
}

function shouldIncludeEntry(relativePath: string, name: string, filter?: string): boolean {
  if (!filter) return true;
  return matchGlob(relativePath, filter) || matchGlob(name, filter);
}

async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function validateWorkspacePath(fullPath: string, workspace: string): Promise<boolean> {
  const resolvedWorkspace = await safeRealpath(workspace);
  const normalizedWorkspace = resolvedWorkspace.endsWith(sep) ? resolvedWorkspace : resolvedWorkspace + sep;

  try {
    const resolved = await safeRealpath(fullPath);
    return resolved === resolvedWorkspace || resolved.startsWith(normalizedWorkspace);
  } catch {
    const fallback = resolve(fullPath);
    return fallback === resolvedWorkspace || fallback.startsWith(normalizedWorkspace);
  }
}

function toRelativePath(targetPath: string, basePath: string): string {
  const next = normalizePath(relative(basePath, targetPath));
  if (!next || next === '.') return '.';
  return next;
}

export async function walkWorkspace(
  workspace: string,
  startPath: string,
  options: DiscoveryWalkOptions = {},
): Promise<DiscoveryWalkResult> {
  const includeHidden = options.includeHidden === true;
  const includeFiles = options.includeFiles !== false;
  const includeDirectories = options.includeDirectories === true;
  const maxDepth = typeof options.maxDepth === 'number' ? Math.max(0, options.maxDepth) : Number.POSITIVE_INFINITY;
  const relativeBase = options.relativeTo === 'start'
    ? resolve(workspace, startPath)
    : resolve(workspace);
  const rootPath = resolve(workspace, startPath);
  const entries: DiscoveryEntry[] = [];
  const errors: string[] = [];
  const queue: Array<{ absolutePath: string; depth: number }> = [{ absolutePath: rootPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let currentEntries;
    try {
      currentEntries = await readdir(current.absolutePath, { withFileTypes: true });
    } catch (error) {
      errors.push(`${normalizePath(current.absolutePath)}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    currentEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of currentEntries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;

      const absolutePath = resolve(current.absolutePath, entry.name);
      const relativePath = toRelativePath(absolutePath, relativeBase);
      const nextDepth = current.depth + 1;

      if (entry.isDirectory()) {
        const excluded = EXCLUDED_DISCOVERY_DIRECTORIES.has(entry.name);
        if (includeDirectories && shouldIncludeEntry(relativePath, entry.name, options.filter)) {
          entries.push({
            path: relativePath,
            absolutePath,
            name: entry.name,
            type: 'directory',
            depth: nextDepth,
            excluded: excluded || undefined,
          });
        }
        if (!excluded && nextDepth <= maxDepth) {
          queue.push({ absolutePath, depth: nextDepth });
        }
        continue;
      }

      if (!includeFiles || !entry.isFile()) continue;
      if (!shouldIncludeEntry(relativePath, entry.name, options.filter)) continue;
      entries.push({
        path: relativePath,
        absolutePath,
        name: entry.name,
        type: 'file',
        depth: nextDepth,
      });
    }
  }

  return { entries, errors };
}

export function walkWorkspaceSync(
  workspace: string,
  startPath: string,
  options: DiscoveryWalkOptions = {},
): DiscoveryWalkResult {
  const includeHidden = options.includeHidden === true;
  const includeFiles = options.includeFiles !== false;
  const includeDirectories = options.includeDirectories === true;
  const maxDepth = typeof options.maxDepth === 'number' ? Math.max(0, options.maxDepth) : Number.POSITIVE_INFINITY;
  const relativeBase = options.relativeTo === 'start'
    ? resolve(workspace, startPath)
    : resolve(workspace);
  const rootPath = resolve(workspace, startPath);
  const entries: DiscoveryEntry[] = [];
  const errors: string[] = [];
  const queue: Array<{ absolutePath: string; depth: number }> = [{ absolutePath: rootPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let currentEntries;
    try {
      currentEntries = readdirSync(current.absolutePath, { withFileTypes: true });
    } catch (error) {
      errors.push(`${normalizePath(current.absolutePath)}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    currentEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of currentEntries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;

      const absolutePath = resolve(current.absolutePath, entry.name);
      const relativePath = toRelativePath(absolutePath, relativeBase);
      const nextDepth = current.depth + 1;

      if (entry.isDirectory()) {
        const excluded = EXCLUDED_DISCOVERY_DIRECTORIES.has(entry.name);
        if (includeDirectories && shouldIncludeEntry(relativePath, entry.name, options.filter)) {
          entries.push({
            path: relativePath,
            absolutePath,
            name: entry.name,
            type: 'directory',
            depth: nextDepth,
            excluded: excluded || undefined,
          });
        }
        if (!excluded && nextDepth <= maxDepth) {
          queue.push({ absolutePath, depth: nextDepth });
        }
        continue;
      }

      if (!includeFiles || !entry.isFile()) continue;
      if (!shouldIncludeEntry(relativePath, entry.name, options.filter)) continue;
      entries.push({
        path: relativePath,
        absolutePath,
        name: entry.name,
        type: 'file',
        depth: nextDepth,
      });
    }
  }

  return { entries, errors };
}

export async function findFilesByGlob(
  workspace: string,
  startPath: string,
  pattern: string,
): Promise<string[]> {
  const hasRecursiveGlob = pattern.includes('**');
  if (!hasRecursiveGlob) {
    const searchPath = resolve(workspace, startPath);
    const directEntries = await readdir(searchPath, { withFileTypes: true });
    return directEntries
      .filter((entry) => !entry.name.startsWith('.') && entry.isFile() && matchGlob(entry.name, pattern))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  const walked = await walkWorkspace(workspace, startPath, {
    includeFiles: true,
    includeDirectories: false,
    includeHidden: false,
    relativeTo: 'start',
  });

  return walked.entries
    .filter((entry) => entry.type === 'file' && matchGlob(entry.path, pattern))
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));
}

export async function getFileStatSummary(path: string): Promise<{ type: 'file' | 'directory' | 'unknown'; size?: number }> {
  try {
    const value = await stat(path);
    if (value.isDirectory()) {
      return { type: 'directory' };
    }
    if (value.isFile()) {
      return { type: 'file', size: value.size };
    }
    return { type: 'unknown' };
  } catch {
    return { type: 'unknown' };
  }
}

export function getDiscoveryBaseName(path: string): string {
  return basename(path);
}
