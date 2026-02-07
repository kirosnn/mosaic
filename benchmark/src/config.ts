export const CONFIG = {
  mosaicUrl: "http://localhost:8192",
  defaultTimeout: 120_000,
  pingInterval: 5_000,
  benchmarkVersion: "1.0.0",
  resultsDir: "results",
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
