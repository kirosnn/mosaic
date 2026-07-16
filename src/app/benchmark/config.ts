import defaults from "./defaults.json";

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) ? value : fallback;
}

const apiPrefix = envString("MOSAIC_BENCH_API_PREFIX", defaults.apiPrefix).replace(/\/$/, "");

export const BENCHMARK_SERVER_CONFIG = {
  host: envString("MOSAIC_BENCH_HOST", defaults.host),
  portStart: envInteger("MOSAIC_BENCH_PORT_START", defaults.portStart),
  portEnd: envInteger("MOSAIC_BENCH_PORT_END", defaults.portEnd),
  routes: Object.fromEntries(
    Object.entries(defaults.routes).map(([name, route]) => [name, `${apiPrefix}${route}`]),
  ) as typeof defaults.routes,
};
