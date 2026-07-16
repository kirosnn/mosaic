import defaults from "../defaults.json";

function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

const host = envString("MOSAIC_BENCH_HOST", defaults.host);
const portStart = envNumber("MOSAIC_BENCH_PORT_START", defaults.portStart);
const portEnd = envNumber("MOSAIC_BENCH_PORT_END", defaults.portEnd);
const apiPrefix = envString("MOSAIC_BENCH_API_PREFIX", defaults.apiPrefix).replace(/\/$/, "");

export const CONFIG = {
  mosaicUrl: envString("MOSAIC_BENCH_URL", `http://${host}:${portStart}`),
  defaultTimeout: envNumber("MOSAIC_BENCH_TIMEOUT_MS", defaults.defaultTimeout),
  pingInterval: envNumber("MOSAIC_BENCH_PING_INTERVAL_MS", defaults.pingInterval),
  benchmarkVersion: envString("MOSAIC_BENCH_VERSION", defaults.benchmarkVersion),
  resultsDir: envString("MOSAIC_BENCH_RESULTS_DIR", defaults.resultsDir),
  apiPrefix,
  routes: defaults.routes,
  portStart,
  portEnd,
  interTestDelayMs: envNumber("MOSAIC_BENCH_INTER_TEST_DELAY_MS", defaults.interTestDelay),
  interSuiteDelayMs: envNumber("MOSAIC_BENCH_INTER_SUITE_DELAY_MS", defaults.interSuiteDelay),
  interRunDelayMs: envNumber("MOSAIC_BENCH_INTER_RUN_DELAY_MS", defaults.interRunDelay),
  maxAttempts: Math.max(1, Math.floor(envNumber("MOSAIC_BENCH_MAX_ATTEMPTS", defaults.maxAttempts))),
  retryBaseDelayMs: envNumber("MOSAIC_BENCH_RETRY_BASE_DELAY_MS", defaults.retryBaseDelay),
  retryMaxDelayMs: envNumber("MOSAIC_BENCH_RETRY_MAX_DELAY_MS", defaults.retryMaxDelay),
  rateLimitMaxWaitMs: envNumber("MOSAIC_BENCH_RATE_LIMIT_MAX_WAIT_MS", defaults.rateLimitMaxWait),
};

export async function discoverMosaicUrl(): Promise<string> {
  for (let port = CONFIG.portStart; port <= CONFIG.portEnd; port++) {
    const url = `http://${host}:${port}`;
    try {
      const res = await fetch(`${url}${CONFIG.apiPrefix}${CONFIG.routes.config}`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        CONFIG.mosaicUrl = url;
        return url;
      }
    } catch {}
  }
  throw new Error(`Mosaic not found on ports ${CONFIG.portStart}-${CONFIG.portEnd}`);
}
