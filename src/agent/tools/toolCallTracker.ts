type CachedResult = {
  result: string | Record<string, unknown>;
  preview: string;
  timestamp: number;
};

type PersistentCachedResult = {
  result: string | Record<string, unknown>;
  preview: string;
  timestamp: number;
  tool: string;
};

const callCache: Map<string, CachedResult> = new Map();
const persistentCache: Map<string, PersistentCachedResult> = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PERSISTENT_SIZE = 300;
const PERSISTENT_TTL_MS = 30 * 60 * 1000;

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

function evictStale(): void {
  if (callCache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of callCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
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
  const now = Date.now();
  for (const [key, entry] of persistentCache) {
    if (now - entry.timestamp > PERSISTENT_TTL_MS) {
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
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      callCache.delete(sig);
    } else {
      return cached;
    }
  }

  const persistent = persistentCache.get(sig);
  if (persistent) {
    if (Date.now() - persistent.timestamp > PERSISTENT_TTL_MS) {
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
  callCache.set(sig, { result, preview, timestamp: now });
  persistentCache.set(sig, { result, preview, timestamp: now, tool });
  evictStale();
  evictPersistentStale();
}

export function resetTracker(): void {
  callCache.clear();
}

export function clearPersistentCache(): void {
  persistentCache.clear();
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
