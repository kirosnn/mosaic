import { RateLimitError } from "../types.js";
import type { BenchmarkReport, TestCase, SuiteResult, TestResult, PerformanceMetrics } from "../types.js";
import { CONFIG, discoverMosaicUrl } from "../config.js";
import { MosaicClient } from "../client/mosaic-client.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { TestRunner } from "./test-runner.js";
import { SuiteRunner } from "./suite-runner.js";
import { computeOverall } from "../scoring/weights.js";
import { generateReport, printSummary } from "../scoring/report.js";

import { toolUseSuite } from "../suites/tool-use/index.js";
import { reasoningSuite } from "../suites/reasoning/index.js";
import { codeReadingSuite } from "../suites/code-reading/index.js";
import { protocolSuite } from "../suites/protocol/index.js";
import { safetySuite } from "../suites/safety/index.js";

const ALL_SUITES: Record<string, TestCase[]> = {
  "tool-use": toolUseSuite,
  reasoning: reasoningSuite,
  "code-reading": codeReadingSuite,
  protocol: protocolSuite,
  safety: safetySuite,
};

const NUM_RUNS = 4;

export interface HarnessOptions {
  suiteFilter?: string;
  testFilter?: string;
  outputPath?: string;
  verbose: boolean;
  runs?: number;
  provider?: string;
  model?: string;
}

export async function runBenchmark(options: HarnessOptions): Promise<void> {
  const start = Date.now();
  const client = new MosaicClient();
  const workspaceManager = new WorkspaceManager();

  console.log("Discovering Mosaic...");
  let config: { provider: string; model: string };
  let originalConfig: { provider: string; model: string } | null = null;
  try {
    const url = await discoverMosaicUrl();
    console.log(`Found Mosaic at ${url}`);
    config = await client.getConfig();

    if (options.provider || options.model) {
      originalConfig = { provider: config.provider, model: config.model };
      const updated = await client.setConfig({
        provider: options.provider,
        model: options.model,
      });
      config = updated;
      console.log(`Config overridden for this benchmark: provider=${config.provider}, model=${config.model}`);
    } else {
      console.log(`Connected: provider=${config.provider}, model=${config.model}`);
    }
  } catch (err) {
    console.error("Cannot find Mosaic on ports 8192-8200");
    console.error("Make sure Mosaic is running (bun run dev or mosaic web)");
    process.exit(1);
  }

  const restoreConfig = async () => {
    if (originalConfig) {
      try {
        await client.setConfig(originalConfig);
        console.log(`Config restored: provider=${originalConfig.provider}, model=${originalConfig.model}`);
      } catch {}
    }
  };

  let suitesToRun = { ...ALL_SUITES };

  if (options.suiteFilter) {
    const filtered: Record<string, TestCase[]> = {};
    if (ALL_SUITES[options.suiteFilter]) {
      filtered[options.suiteFilter] = ALL_SUITES[options.suiteFilter];
    } else {
      console.error(`Unknown suite: ${options.suiteFilter}`);
      console.error(`Available: ${Object.keys(ALL_SUITES).join(", ")}`);
      await restoreConfig();
      process.exit(1);
    }
    suitesToRun = filtered;
  }

  if (options.testFilter) {
    for (const [suite, tests] of Object.entries(suitesToRun)) {
      suitesToRun[suite] = tests.filter((t) => t.id.includes(options.testFilter!));
    }
    for (const [suite, tests] of Object.entries(suitesToRun)) {
      if (tests.length === 0) delete suitesToRun[suite];
    }
    if (Object.keys(suitesToRun).length === 0) {
      console.error(`No tests match filter: ${options.testFilter}`);
      await restoreConfig();
      process.exit(1);
    }
  }

  const totalRuns = options.runs ?? NUM_RUNS;
  const allRunResults: SuiteResult[][] = [];

  try {
    for (let run = 1; run <= totalRuns; run++) {
      console.log(`\n== Run ${run}/${totalRuns} ==`);
      const testRunner = new TestRunner(client, workspaceManager, options.verbose);
      const suiteRunner = new SuiteRunner(testRunner);
      const runResults: SuiteResult[] = [];

      try {
        for (const [suiteName, tests] of Object.entries(suitesToRun)) {
          const result = await suiteRunner.run(suiteName, tests);
          runResults.push(result);
        }
      } finally {
        workspaceManager.cleanup();
      }

      allRunResults.push(runResults);
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.error("\n========================================");
      console.error("  BENCHMARK ANNULE - RATE LIMIT");
      console.error("========================================");
      console.error(`  ${err.message}`);
      console.error("  Resultats declares nuls.");
      console.error("========================================\n");
      await restoreConfig();
      process.exit(1);
    }
    throw err;
  }

  await restoreConfig();

  const averaged = averageRuns(allRunResults);
  const capability = computeOverall(Object.fromEntries(averaged.map((s) => [s.suite, s.score])));
  const reliability = computeReliability(allRunResults);
  const overall = Math.round(0.85 * capability + 0.15 * reliability);
  const performance = aggregatePerformance(allRunResults);

  const report: BenchmarkReport = {
    version: CONFIG.benchmarkVersion,
    timestamp: new Date().toISOString(),
    provider: config.provider,
    model: config.model,
    runs: totalRuns,
    suites: averaged,
    capability,
    reliability,
    overall,
    performance,
    duration: Date.now() - start,
  };

  printSummary(report);
  generateReport(report);
}

function computeReliability(allRuns: SuiteResult[][]): number {
  if (allRuns.length <= 1) return 100;

  const testStddevs: number[] = [];
  const suiteNames = allRuns[0].map((s) => s.suite);

  for (const suiteName of suiteNames) {
    const suitesAcrossRuns = allRuns.map((run) => run.find((s) => s.suite === suiteName)!);
    const testIds = suitesAcrossRuns[0].tests.map((t) => t.testId);

    for (const testId of testIds) {
      const percentages = suitesAcrossRuns.map((s) => s.tests.find((t) => t.testId === testId)!.percentage);
      const mean = percentages.reduce((s, p) => s + p, 0) / percentages.length;
      const variance = percentages.reduce((s, p) => s + (p - mean) ** 2, 0) / percentages.length;
      testStddevs.push(Math.sqrt(variance));
    }
  }

  const meanStddev = testStddevs.reduce((s, d) => s + d, 0) / testStddevs.length;
  return Math.round(Math.max(0, Math.min(100, 100 - meanStddev * 2)));
}

function aggregatePerformance(allRuns: SuiteResult[][]): PerformanceMetrics {
  let totalTtft = 0;
  let totalCps = 0;
  let count = 0;

  for (const run of allRuns) {
    for (const suite of run) {
      for (const test of suite.tests) {
        if (test.performance.charsPerSecond > 0) {
          totalTtft += test.performance.ttftMs;
          totalCps += test.performance.charsPerSecond;
          count++;
        }
      }
    }
  }

  return {
    ttftMs: count > 0 ? Math.round(totalTtft / count) : 0,
    charsPerSecond: count > 0 ? Math.round(totalCps / count) : 0,
  };
}

function averageRuns(allRuns: SuiteResult[][]): SuiteResult[] {
  if (allRuns.length === 0) return [];
  if (allRuns.length === 1) return allRuns[0];

  const suiteNames = allRuns[0].map((s) => s.suite);
  const averaged: SuiteResult[] = [];

  for (const suiteName of suiteNames) {
    const suitesAcrossRuns = allRuns.map((run) => run.find((s) => s.suite === suiteName)!);
    const testIds = suitesAcrossRuns[0].tests.map((t) => t.testId);

    const avgTests: TestResult[] = testIds.map((testId) => {
      const testsAcrossRuns = suitesAcrossRuns.map((s) => s.tests.find((t) => t.testId === testId)!);
      const n = testsAcrossRuns.length;

      const avgPercentage = Math.round(testsAcrossRuns.reduce((s, t) => s + t.percentage, 0) / n);
      const avgScore = Math.round(testsAcrossRuns.reduce((s, t) => s + t.score, 0) / n);
      const avgDuration = Math.round(testsAcrossRuns.reduce((s, t) => s + t.duration, 0) / n);
      const avgTtft = Math.round(testsAcrossRuns.reduce((s, t) => s + t.performance.ttftMs, 0) / n);
      const avgCps = Math.round(testsAcrossRuns.reduce((s, t) => s + t.performance.charsPerSecond, 0) / n);

      const best = testsAcrossRuns.reduce((best, t) => (t.percentage >= best.percentage ? t : best));

      return {
        testId,
        suite: best.suite,
        name: best.name,
        score: avgScore,
        maxScore: best.maxScore,
        percentage: avgPercentage,
        ruleResults: best.ruleResults,
        performance: { ttftMs: avgTtft, charsPerSecond: avgCps },
        duration: avgDuration,
        timedOut: testsAcrossRuns.some((t) => t.timedOut),
        error: testsAcrossRuns.find((t) => t.error)?.error,
      };
    });

    const suiteScore = avgTests.length > 0
      ? Math.round(avgTests.reduce((s, t) => s + t.percentage, 0) / avgTests.length)
      : 0;

    averaged.push({ suite: suiteName, score: suiteScore, tests: avgTests });
  }

  return averaged;
}
