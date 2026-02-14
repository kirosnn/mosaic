import { RateLimitError } from "../types.js";
import type { TestCase, TestResult, TestContext } from "../types.js";
import { CONFIG } from "../config.js";
import { MosaicClient } from "../client/mosaic-client.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { scoreTest } from "../scoring/scorer.js";
import type { FixtureName } from "../workspace/fixtures.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = exp * (0.15 + Math.random() * 0.2);
  return Math.round(Math.min(max, exp + jitter));
}

export class TestRunner {
  private client: MosaicClient;
  private workspaceManager: WorkspaceManager;
  private verbose: boolean;

  constructor(client: MosaicClient, workspaceManager: WorkspaceManager, verbose: boolean) {
    this.client = client;
    this.workspaceManager = workspaceManager;
    this.verbose = verbose;
  }

  async run(test: TestCase): Promise<TestResult> {
    const start = Date.now();

    const { path: workspacePath, benchSecret } = this.workspaceManager.create(test.fixture as FixtureName);

    try {
      await this.client.setWorkspace(workspacePath);

      const requireApprovals = test.approvalPolicy === "approve-all" || test.approvalPolicy === "deny-all";
      await this.client.setApprovals(requireApprovals);

      if (this.verbose) {
        console.log(`    Running: ${test.name}`);
        console.log(`    Prompt:  ${test.prompt.substring(0, 80)}...`);
        console.log(`    Workspace: ${workspacePath}`);
      }

      const baseTimeout = test.timeout ?? CONFIG.defaultTimeout;
      let lastRateLimit: RateLimitError | null = null;
      let lastCtx: TestContext | null = null;

      for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
        const timeout = attempt <= 1 ? baseTimeout : Math.round(Math.min(baseTimeout * 3, baseTimeout * (1 + 0.5 * (attempt - 1))));
        try {
          const collected = await this.client.sendMessage(test.prompt, test.approvalPolicy ?? "auto", timeout);
          const ctx: TestContext = { ...collected, benchSecret };
          lastCtx = ctx;

          if (ctx.timedOut && attempt < CONFIG.maxAttempts) {
            await this.client.stop();
            const waitMs = backoffMs(attempt, CONFIG.retryBaseDelayMs, CONFIG.retryMaxDelayMs);
            await sleep(waitMs);
            continue;
          }

          if (this.verbose) {
            console.log(`    Tool calls: ${ctx.toolCalls.map((tc) => tc.toolName).join(", ") || "none"}`);
            console.log(`    Output length: ${ctx.textOutput.length}`);
            if (ctx.timedOut) console.log(`    TIMED OUT`);
            if (ctx.error) console.log(`    ERROR: ${ctx.error}`);
          }

          const { score, maxScore, percentage, ruleResults, performance } = scoreTest(test.rules, ctx);
          const duration = Date.now() - start;

          return {
            testId: test.id,
            suite: test.suite,
            name: test.name,
            score,
            maxScore,
            percentage,
            ruleResults,
            performance,
            duration,
            timedOut: ctx.timedOut,
            error: ctx.error,
          };
        } catch (err) {
          if (err instanceof RateLimitError) {
            lastRateLimit = err;
            if (attempt < CONFIG.maxAttempts) {
              await this.client.stop();
              const base = err.retryAfterMs ?? backoffMs(attempt, CONFIG.retryBaseDelayMs, CONFIG.retryMaxDelayMs);
              const waitMs = Math.min(CONFIG.rateLimitMaxWaitMs, Math.max(0, base));
              await sleep(waitMs);
              continue;
            }
            break;
          }
          throw err;
        }
      }

      if (lastRateLimit) {
        const duration = Date.now() - start;
        return {
          testId: test.id,
          suite: test.suite,
          name: test.name,
          score: 0,
          maxScore: test.rules.reduce((sum, r) => sum + r.weight, 0),
          percentage: 0,
          ruleResults: [],
          performance: { ttftMs: 0, charsPerSecond: 0 },
          duration,
          timedOut: false,
          error: lastRateLimit.message,
        };
      }

      if (lastCtx) {
        const { score, maxScore, percentage, ruleResults, performance } = scoreTest(test.rules, lastCtx);
        const duration = Date.now() - start;
        return {
          testId: test.id,
          suite: test.suite,
          name: test.name,
          score,
          maxScore,
          percentage,
          ruleResults,
          performance,
          duration,
          timedOut: lastCtx.timedOut,
          error: lastCtx.error,
        };
      }

      throw new Error("No attempt completed");
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      const duration = Date.now() - start;
      return {
        testId: test.id,
        suite: test.suite,
        name: test.name,
        score: 0,
        maxScore: test.rules.reduce((sum, r) => sum + r.weight, 0),
        percentage: 0,
        ruleResults: [],
        performance: { ttftMs: 0, charsPerSecond: 0 },
        duration,
        timedOut: false,
        error: String(err),
      };
    }
  }
}
