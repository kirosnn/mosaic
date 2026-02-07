import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import sharp from "sharp";
import { LIGHT, DARK, type Theme } from "./themes.js";
import { renderCard, type CardData } from "./card-renderer.js";
import type { BenchmarkReport } from "../types.js";

interface ModelsDevData {
  [provider: string]: {
    name?: string;
    models?: { [model: string]: { name?: string } };
  };
}

export async function fetchLogo(provider: string, theme: Theme): Promise<{ inner: string; viewBox: string } | null> {
  try {
    const url = `https://models.dev/logos/${provider}.svg`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const svg = await res.text();

    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch?.[1] ?? `0 0 24 24`;

    const innerMatch = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    if (!innerMatch) return null;

    let inner = innerMatch[1];
    inner = inner.replace(/fill="currentColor"/g, `fill="${theme.text}"`);

    return { inner, viewBox };
  } catch {
    return null;
  }
}

export async function fetchDisplayNames(
  provider: string,
  model: string,
): Promise<{ provider: string; model: string }> {
  const fallback = {
    provider: provider.charAt(0).toUpperCase() + provider.slice(1),
    model,
  };

  try {
    const res = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback;

    const data = (await res.json()) as ModelsDevData;
    const pEntry = data[provider];
    if (!pEntry) return fallback;

    const displayProvider = pEntry.name ?? fallback.provider;
    const displayModel = pEntry.models?.[model]?.name ?? fallback.model;

    return { provider: displayProvider, model: displayModel };
  } catch {
    return fallback;
  }
}

function findAllReports(resultsDir: string): string[] {
  if (!existsSync(resultsDir)) {
    throw new Error(`Results directory not found: ${resultsDir}`);
  }

  const files = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No benchmark reports found in ${resultsDir}`);
  }

  return files.map((f) => join(resultsDir, f));
}

export function normalizeReport(raw: Record<string, unknown>): BenchmarkReport {
  const report = raw as unknown as BenchmarkReport;

  if (report.performance === undefined) {
    const allTests = report.suites.flatMap((s) => s.tests);
    const perfs = allTests
      .map((t) => (t as Record<string, unknown>).performance ?? (t as Record<string, unknown>).latency)
      .filter(Boolean) as Array<Record<string, unknown>>;

    const avgTtft =
      perfs.length > 0
        ? Math.round(perfs.reduce((s, p) => s + Number(p.ttftMs ?? 0), 0) / perfs.length)
        : 0;
    const avgCps =
      perfs.length > 0
        ? Math.round(perfs.reduce((s, p) => s + Number(p.charsPerSecond ?? 0), 0) / perfs.length)
        : 0;

    report.performance = { ttftMs: avgTtft, charsPerSecond: avgCps };
  }

  if (report.capability === undefined) {
    report.capability = report.overall ?? 0;
  }

  if (report.reliability === undefined) {
    const allTests = report.suites.flatMap((s) => s.tests);
    const passed = allTests.filter((t) => t.percentage === 100).length;
    report.reliability = allTests.length > 0 ? Math.round((passed / allTests.length) * 100) : 0;
  }

  return report;
}

async function generateCards(reportPath: string): Promise<void> {
  const raw = readFileSync(reportPath, "utf-8");
  const report = normalizeReport(JSON.parse(raw));

  console.log(`Generating visuals for ${report.provider}/${report.model}...`);

  const [displayNames, lightLogo, darkLogo] = await Promise.all([
    fetchDisplayNames(report.provider, report.model),
    fetchLogo(report.provider, LIGHT),
    fetchLogo(report.provider, DARK),
  ]);

  const resultsDir = resolve(reportPath, "..");
  const basename = reportPath.replace(/\\/g, "/").split("/").pop()?.replace(".json", "") ?? "";
  const ts = basename.match(/\d+/)?.[0] ?? String(Date.now());

  for (const [theme, logo] of [
    [LIGHT, lightLogo],
    [DARK, darkLogo],
  ] as const) {
    const cardData: CardData = {
      report,
      logoSvgInner: logo?.inner ?? null,
      logoViewBox: logo?.viewBox ?? null,
      displayProvider: displayNames.provider,
      displayModel: displayNames.model,
    };

    const svg = renderCard(cardData, theme);
    const pngPath = join(resultsDir, `benchmark-${ts}-${theme.name}.png`);

    await sharp(Buffer.from(svg)).png().toFile(pngPath);
    console.log(`  ${theme.name}: ${pngPath}`);
  }

  console.log("Done.");
}

const resultsDir = resolve(import.meta.dir, "../../results");

const reportPaths = process.argv[2]
  ? [resolve(process.argv[2])]
  : findAllReports(resultsDir);

for (const reportPath of reportPaths) {
  if (!existsSync(resolve(reportPath, ".."))) {
    mkdirSync(resolve(reportPath, ".."), { recursive: true });
  }
  await generateCards(reportPath);
}
