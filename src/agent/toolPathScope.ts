import { homedir } from 'os';
import { isAbsolute, relative, resolve, sep } from 'path';
import { realpath } from 'fs/promises';

export interface ResolvedToolPath {
  requestedPath: string;
  absolutePath: string;
  withinWorkspace: boolean;
  workspaceRelativePath: string | null;
  displayPath: string;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  let expanded = trimmed;
  const home = homedir();

  if (expanded === '~' || expanded.startsWith(`~${sep}`) || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = resolve(home, expanded.slice(2));
  }

  expanded = expanded.replace(/%([A-Z0-9_]+)%/gi, (_match, name: string) => process.env[name] ?? `%${name}%`);
  expanded = expanded.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_match, shortName: string, longName: string) => {
    const key = shortName || longName;
    return process.env[key] ?? _match;
  });

  return expanded;
}

async function safeRealPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function resolveToolPath(workspaceRoot: string, requestedPath: string): Promise<ResolvedToolPath> {
  const expandedPath = expandUserPath(requestedPath);
  const absolutePath = isAbsolute(expandedPath)
    ? resolve(expandedPath)
    : resolve(workspaceRoot, expandedPath);
  const resolvedWorkspace = await safeRealPath(workspaceRoot);
  const resolvedTarget = await safeRealPath(absolutePath);
  const normalizedWorkspace = resolvedWorkspace.endsWith(sep) ? resolvedWorkspace : `${resolvedWorkspace}${sep}`;
  const withinWorkspace = resolvedTarget === resolvedWorkspace || resolvedTarget.startsWith(normalizedWorkspace);
  const workspaceRelativePath = withinWorkspace
    ? normalizePath(relative(resolvedWorkspace, resolvedTarget) || '.')
    : null;

  return {
    requestedPath,
    absolutePath: resolvedTarget,
    withinWorkspace,
    workspaceRelativePath,
    displayPath: withinWorkspace ? (workspaceRelativePath || '.') : normalizePath(resolvedTarget),
  };
}

export function resolveReviewPath(workspaceRoot: string, path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(workspaceRoot, path);
}
