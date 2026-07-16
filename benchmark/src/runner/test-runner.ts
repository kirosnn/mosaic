import { RateLimitError } from "../types.js";
import type { ApprovalPolicy, BenchmarkMessage, CollectorResult, TestCase, TestResult, TestContext } from "../types.js";
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

function combineTurnResults(results: CollectorResult[]): CollectorResult {
  return {
    toolCalls: results.flatMap((result) => result.toolCalls),
    textOutput: results.map((result) => result.textOutput).join("\n"),
    events: results.flatMap((result) => result.events),
    approvalRequests: results.flatMap((result) => result.approvalRequests),
    questionRequests: results.flatMap((result) => result.questionRequests),
    timedOut: results.some((result) => result.timedOut),
    error: results.find((result) => result.error)?.error,
    latency: {
      ttftMs: results[0]?.latency.ttftMs ?? 0,
      totalChars: results.reduce((sum, result) => sum + result.latency.totalChars, 0),
      streamDurationMs: results.reduce((sum, result) => sum + result.latency.streamDurationMs, 0),
    },
  };
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
          const turns = test.turns ?? [{ prompt: test.prompt, approvalPolicy: test.approvalPolicy }];
          const history: BenchmarkMessage[] = [];
          const turnResults: CollectorResult[] = [];
          for (const turn of turns) {
            const policy: ApprovalPolicy = turn.approvalPolicy ?? test.approvalPolicy ?? "auto";
            const collected = await this.client.sendMessage(turn.prompt, policy, timeout, history);
            turnResults.push(collected);
            history.push(
              { role: "user", content: turn.prompt },
              { role: "assistant", content: collected.textOutput },
            );
            if (collected.timedOut || collected.error) break;
          }
          const collected = combineTurnResults(turnResults);
          const ctx: TestContext = { ...collected, benchSecret, turnResults };
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
