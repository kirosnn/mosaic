import type { TestCase, SuiteResult, TestResult } from "../types.js";
import { TestRunner } from "./test-runner.js";

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
    }

    const score =
      results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length)
        : 0;

    return { suite: suiteName, score, tests: results };
  }
}
