import { RateLimitError } from "../types.js";
import type { TestCase, TestResult, TestContext } from "../types.js";
import { CONFIG } from "../config.js";
import { MosaicClient } from "../client/mosaic-client.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { scoreTest } from "../scoring/scorer.js";
import type { FixtureName } from "../workspace/fixtures.js";

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

      const collected = await this.client.sendMessage(
        test.prompt,
        test.approvalPolicy ?? "auto",
        test.timeout ?? CONFIG.defaultTimeout,
      );

      const ctx: TestContext = { ...collected, benchSecret };

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
