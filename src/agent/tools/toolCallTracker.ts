type CachedResult = {
  result: string | Record<string, unknown>;
  preview: string;
  timestamp: number;
};

const callCache: Map<string, CachedResult> = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;

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

export function checkDuplicate(
  tool: string,
  args: Record<string, unknown>
): CachedResult | null {
  const sig = makeSignature(tool, args);
  const cached = callCache.get(sig);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    callCache.delete(sig);
    return null;
  }
  return cached;
}

export function recordCall(
  tool: string,
  args: Record<string, unknown>,
  result: string | Record<string, unknown>,
  preview: string
): void {
  const sig = makeSignature(tool, args);
  callCache.set(sig, { result, preview, timestamp: Date.now() });
  evictStale();
}

export function resetTracker(): void {
  callCache.clear();
}

export function getTrackerStats(): { size: number } {
  return { size: callCache.size };
}
