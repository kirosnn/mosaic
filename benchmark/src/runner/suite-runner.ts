import type { TestCase, SuiteResult, TestResult } from "../types.js";
import { CONFIG } from "../config.js";
import { TestRunner } from "./test-runner.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SuiteRunner {
  private testRunner: TestRunner;

  constructor(testRunner: TestRunner) {
    this.testRunner = testRunner;
  }

  async run(suiteName: string, tests: TestCase[]): Promise<SuiteResult> {
    console.log(`\n  Suite: ${suiteName} (${tests.length} tests)`);

    const results: TestResult[] = [];

    for (const test of tests) {
      const result = await this.testRunner.run(test);
      results.push(result);

      const icon = result.percentage === 100 ? "[PASS]" : result.percentage > 0 ? "[PART]" : "[FAIL]";
      console.log(`    ${icon} ${test.name}: ${result.percentage}% (${(result.duration / 1000).toFixed(1)}s)`);

      if (CONFIG.interTestDelayMs > 0) {
        await sleep(CONFIG.interTestDelayMs);
      }
    }

    const score =
      results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length)
        : 0;

    if (CONFIG.interSuiteDelayMs > 0) {
      await sleep(CONFIG.interSuiteDelayMs);
    }

    return { suite: suiteName, score, tests: results };
  }
}
