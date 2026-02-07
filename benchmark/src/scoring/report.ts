import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { CONFIG } from "../config.js";
import { SUITE_WEIGHTS } from "./weights.js";
import type { BenchmarkReport, SuiteResult } from "../types.js";

export function generateReport(report: BenchmarkReport): void {
  if (!existsSync(CONFIG.resultsDir)) {
    mkdirSync(CONFIG.resultsDir, { recursive: true });
  }

  const filename = `benchmark-${Date.now()}.json`;
  const filepath = join(CONFIG.resultsDir, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved to ${filepath}`);
}

export function printSummary(report: BenchmarkReport): void {
  console.log("\n========================================");
  console.log("  MOSAIC BENCHMARK RESULTS");
  console.log("========================================");
  console.log(`  Version:  ${report.version}`);
  console.log(`  Provider: ${report.provider}`);
  console.log(`  Model:    ${report.model}`);
  console.log(`  Runs:     ${report.runs}`);
  console.log(`  Date:     ${report.timestamp}`);
  console.log(`  Duration: ${(report.duration / 1000).toFixed(1)}s`);
  console.log("----------------------------------------");

  for (const suite of report.suites) {
    const weight = SUITE_WEIGHTS[suite.suite] ?? 0;
    const bar = renderBar(suite.score);
    console.log(`  ${suite.suite.padEnd(14)} ${bar} ${suite.score}% (x${weight})`);
    printSuiteDetails(suite);
  }

  console.log("----------------------------------------");
  console.log(`  Capability:    ${renderBar(report.capability)} ${report.capability}%`);
  console.log(`  Reliability:   ${renderBar(report.reliability)} ${report.reliability}%`);
  console.log(`  OVERALL:       ${renderBar(report.overall)} ${report.overall}%`);
  console.log("----------------------------------------");
  console.log("  Performance (not scored):");
  console.log(`    TTFT:        ${report.performance.ttftMs}ms`);
  console.log(`    Throughput:  ${report.performance.charsPerSecond} chars/s`);
  console.log("========================================\n");
}

function printSuiteDetails(suite: SuiteResult): void {
  for (const test of suite.tests) {
    const icon = test.percentage === 100 ? "  [PASS]" : test.percentage > 0 ? "  [PART]" : "  [FAIL]";
    const perf = test.performance.charsPerSecond > 0
      ? ` | ${test.performance.ttftMs}ms, ${test.performance.charsPerSecond} c/s`
      : "";
    console.log(`    ${icon} ${test.name} (${test.percentage}%)${perf}`);
    for (const r of test.ruleResults) {
      if (!r.passed) {
        const tag = r.isCritical ? "CRIT" : "MISS";
        console.log(`           [${tag}] ${r.description}`);
      }
    }
  }
}

function renderBar(percent: number): string {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return "[" + "#".repeat(filled) + "-".repeat(empty) + "]";
}
