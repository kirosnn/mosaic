import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { LIGHT, DARK } from "./themes.js";
import { fetchLogo, fetchDisplayNames, normalizeReport } from "./generate.js";
import { renderComparison, assignColors, type ModelEntry } from "./comparison-renderer.js";
import { writePngFromSvg } from "./image.js";
import type { BenchmarkReport } from "../types.js";

const resultsDir = resolve(import.meta.dir, "../../results");

function listReports(): { path: string; report: BenchmarkReport }[] {
  if (!existsSync(resultsDir)) {
    console.error(`Results directory not found: ${resultsDir}`);
    process.exit(1);
  }

  const files = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.error("No benchmark reports found in results/");
    process.exit(1);
  }

  return files.map((f) => {
    const raw = JSON.parse(readFileSync(join(resultsDir, f), "utf-8"));
    const report = normalizeReport(raw);
    return { path: join(resultsDir, f), report };
  });
}

function prompt(question: string): Promise<string> {
  return new Promise((res) => {
    process.stdout.write(question);
    let data = "";
    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      if (data.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        res(data.trim());
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let imageScale = Number(process.env.MOSAIC_BENCH_IMAGE_SCALE ?? 2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--scale") {
      imageScale = Number(args[i + 1]);
      i++;
      continue;
    }
    if (a.startsWith("--scale=")) {
      imageScale = Number(a.slice("--scale=".length));
      continue;
    }
  }

  const reports = listReports();

  console.log("\n  MOSAIC BENCHMARK COMPARISON\n");
  console.log("  Available reports:\n");

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i].report;
    const label = `${r.provider}/${r.model}`;
    const date = r.timestamp.split("T")[0] ?? "";
    console.log(`    [${i + 1}]  ${label.padEnd(40)} overall: ${r.overall}%   ${date}`);
  }

  console.log("");
  const answer = await prompt("  Select reports to compare (space-separated numbers, e.g. 1 3 4): ");

  const indices = answer
    .split(/\s+/)
    .map((s) => parseInt(s, 10) - 1)
    .filter((i) => i >= 0 && i < reports.length);

  if (indices.length < 2) {
    console.error("\n  Please select at least 2 reports to compare.");
    process.exit(1);
  }

  const selected = indices.map((i) => reports[i]);
  console.log(`\n  Comparing ${selected.length} models...\n`);

  const fetchTasks = selected.map(async ({ report }) => {
    const [displayNames, lightLogo, darkLogo] = await Promise.all([
      fetchDisplayNames(report.provider, report.model),
      fetchLogo(report.provider, LIGHT),
      fetchLogo(report.provider, DARK),
    ]);
    return { report, displayNames, lightLogo, darkLogo };
  });

  const fetched = await Promise.all(fetchTasks);

  const ts = String(Date.now());

  for (const theme of [LIGHT, DARK] as const) {
    const entries: ModelEntry[] = fetched.map((f) => {
      const logo = theme === LIGHT ? f.lightLogo : f.darkLogo;
      return {
        report: f.report,
        logoSvgInner: logo?.inner ?? null,
        logoViewBox: logo?.viewBox ?? null,
        displayProvider: f.displayNames.provider,
        displayModel: f.displayNames.model,
        color: "",
      };
    });

    assignColors(entries);

    const svg = renderComparison(entries, theme);
    const pngPath = join(resultsDir, `comparison-${ts}-${theme.name}.png`);

    await writePngFromSvg(svg, pngPath, imageScale);
    console.log(`  ${theme.name}: ${pngPath}`);
  }

  console.log("\n  Done.\n");
}

await main();
