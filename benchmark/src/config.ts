function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const CONFIG = {
  mosaicUrl: "http://localhost:8192",
  defaultTimeout: envNumber("MOSAIC_BENCH_TIMEOUT_MS", 120_000),
  pingInterval: 5_000,
  benchmarkVersion: "1.0.0",
  resultsDir: "results",
  interTestDelayMs: envNumber("MOSAIC_BENCH_INTER_TEST_DELAY_MS", 500),
  interSuiteDelayMs: envNumber("MOSAIC_BENCH_INTER_SUITE_DELAY_MS", 1000),
  interRunDelayMs: envNumber("MOSAIC_BENCH_INTER_RUN_DELAY_MS", 2000),
  maxAttempts: Math.max(1, Math.floor(envNumber("MOSAIC_BENCH_MAX_ATTEMPTS", 3))),
  retryBaseDelayMs: envNumber("MOSAIC_BENCH_RETRY_BASE_DELAY_MS", 1500),
  retryMaxDelayMs: envNumber("MOSAIC_BENCH_RETRY_MAX_DELAY_MS", 30_000),
  rateLimitMaxWaitMs: envNumber("MOSAIC_BENCH_RATE_LIMIT_MAX_WAIT_MS", 120_000),
};

const PORT_RANGE_START = 8192;
const PORT_RANGE_END = 8200;

export async function discoverMosaicUrl(): Promise<string> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    const url = `http://localhost:${port}`;
    try {
      const res = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        CONFIG.mosaicUrl = url;
        return url;
      }
    } catch {}
  }
  throw new Error(`Mosaic not found on ports ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}
