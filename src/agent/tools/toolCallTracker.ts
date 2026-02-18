type CachedResult = {
  result: string | Record<string, unknown>;
  preview: string;
  timestamp: number;
  tool: string;
  scope: 'stable' | 'path' | 'workspace';
  workspaceRevision: number;
  pathKey?: string;
  pathRevision?: number;
};

type PersistentCachedResult = {
  result: string | Record<string, unknown>;
  preview: string;
  timestamp: number;
  tool: string;
  scope: 'stable' | 'path' | 'workspace';
  workspaceRevision: number;
  pathKey?: string;
  pathRevision?: number;
};

const callCache: Map<string, CachedResult> = new Map();
const persistentCache: Map<string, PersistentCachedResult> = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PERSISTENT_SIZE = 300;
const PERSISTENT_TTL_MS = 30 * 60 * 1000;
const SEARCH_TOOLS = new Set(['grep', 'glob', 'list']);

let workspaceRevision = 0;
let lastUnknownMutationRevision = 0;
const pathRevisions: Map<string, number> = new Map();

function makeSignature(tool: string, args: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) {
      filtered[k] = v;
    }
  }
  const sorted = Object.keys(filtered).sort().reduce((acc, k) => {
    acc[k] = filtered[k];
    return acc;
  }, {} as Record<string, unknown>);
  return `${tool}::${JSON.stringify(sorted)}`;
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, '/').trim().toLowerCase();
}

function resolveScope(tool: string, args: Record<string, unknown>): {
  scope: 'stable' | 'path' | 'workspace';
  pathKey?: string;
  pathRevision?: number;
} {
  if (tool === 'read' && typeof args.path === 'string' && args.path.trim()) {
    const pathKey = normalizePathKey(args.path);
    return {
      scope: 'path',
      pathKey,
      pathRevision: pathRevisions.get(pathKey) ?? 0,
    };
  }

  if (SEARCH_TOOLS.has(tool)) {
    return { scope: 'workspace' };
  }

  return { scope: 'stable' };
}

function isStale(entry: {
  timestamp: number;
  scope: 'stable' | 'path' | 'workspace';
  workspaceRevision: number;
  pathKey?: string;
  pathRevision?: number;
}, ttlMs: number): boolean {
  if (Date.now() - entry.timestamp > ttlMs) return true;

  if (entry.scope === 'workspace') {
    return entry.workspaceRevision !== workspaceRevision;
  }

  if (entry.scope === 'path') {
    if (!entry.pathKey) return true;
    if (entry.workspaceRevision < lastUnknownMutationRevision) return true;
    const currentRevision = pathRevisions.get(entry.pathKey) ?? 0;
    return currentRevision !== (entry.pathRevision ?? 0);
  }

  return false;
}

function shouldInvalidateForMutation(
  entry: { scope: 'stable' | 'path' | 'workspace'; pathKey?: string },
  changedPaths: Set<string> | null
): boolean {
  if (entry.scope === 'workspace') return true;
  if (entry.scope !== 'path') return false;
  if (changedPaths === null) return true;
  if (!entry.pathKey) return true;
  return changedPaths.has(entry.pathKey);
}

function invalidateForMutation(changedPaths: Set<string> | null): void {
  for (const [key, entry] of callCache) {
    if (shouldInvalidateForMutation(entry, changedPaths)) {
      callCache.delete(key);
    }
  }
  for (const [key, entry] of persistentCache) {
    if (shouldInvalidateForMutation(entry, changedPaths)) {
      persistentCache.delete(key);
    }
  }
}

function evictStale(): void {
  if (callCache.size <= MAX_CACHE_SIZE) return;
  for (const [key, entry] of callCache) {
    if (isStale(entry, CACHE_TTL_MS)) {
      callCache.delete(key);
    }
  }
  if (callCache.size > MAX_CACHE_SIZE) {
    const keys = [...callCache.keys()];
    const toRemove = keys.slice(0, callCache.size - MAX_CACHE_SIZE);
    for (const k of toRemove) callCache.delete(k);
  }
}

function evictPersistentStale(): void {
  if (persistentCache.size <= MAX_PERSISTENT_SIZE) return;
  for (const [key, entry] of persistentCache) {
    if (isStale(entry, PERSISTENT_TTL_MS)) {
      persistentCache.delete(key);
    }
  }
  if (persistentCache.size > MAX_PERSISTENT_SIZE) {
    const keys = [...persistentCache.keys()];
    const toRemove = keys.slice(0, persistentCache.size - MAX_PERSISTENT_SIZE);
    for (const k of toRemove) persistentCache.delete(k);
  }
}

export function checkDuplicate(
  tool: string,
  args: Record<string, unknown>
): CachedResult | null {
  const sig = makeSignature(tool, args);

  const cached = callCache.get(sig);
  if (cached) {
    if (isStale(cached, CACHE_TTL_MS)) {
      callCache.delete(sig);
    } else {
      return cached;
    }
  }

  const persistent = persistentCache.get(sig);
  if (persistent) {
    if (isStale(persistent, PERSISTENT_TTL_MS)) {
      persistentCache.delete(sig);
      return null;
    }
    return persistent;
  }

  return null;
}

export function recordCall(
  tool: string,
  args: Record<string, unknown>,
  result: string | Record<string, unknown>,
  preview: string
): void {
  const sig = makeSignature(tool, args);
  const now = Date.now();
  const scopeState = resolveScope(tool, args);
  const entry = {
    result,
    preview,
    timestamp: now,
    tool,
    scope: scopeState.scope,
    workspaceRevision,
    pathKey: scopeState.pathKey,
    pathRevision: scopeState.pathRevision,
  } as const;
  callCache.set(sig, entry);
  persistentCache.set(sig, entry);
  evictStale();
  evictPersistentStale();
}

export function trackMutation(paths?: string[] | string): void {
  workspaceRevision++;

  const pathList = typeof paths === 'string'
    ? [paths]
    : Array.isArray(paths)
      ? paths
      : [];
  const normalized = pathList
    .filter((p): p is string => typeof p === 'string')
    .map((p) => normalizePathKey(p))
    .filter(Boolean);

  if (normalized.length === 0) {
    lastUnknownMutationRevision = workspaceRevision;
    invalidateForMutation(null);
    return;
  }

  const changedSet = new Set<string>();
  for (const pathKey of normalized) {
    pathRevisions.set(pathKey, workspaceRevision);
    changedSet.add(pathKey);
  }
  invalidateForMutation(changedSet);
}

export function resetTracker(): void {
  callCache.clear();
}

export function clearPersistentCache(): void {
  persistentCache.clear();
  workspaceRevision = 0;
  lastUnknownMutationRevision = 0;
  pathRevisions.clear();
}

export function getTrackerStats(): { size: number } {
  return { size: callCache.size };
}

export function getPersistentStats(): { total: number; byTool: Record<string, number> } {
  const byTool: Record<string, number> = {};
  for (const entry of persistentCache.values()) {
    byTool[entry.tool] = (byTool[entry.tool] || 0) + 1;
  }
  return { total: persistentCache.size, byTool };
}
