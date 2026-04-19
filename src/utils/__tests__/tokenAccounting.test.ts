import { describe, expect, it } from "bun:test";
import { calculateHonestTokenBreakdown } from "../tokenAccounting";

describe("token accounting", () => {
  it("excludes prompt tokens from displayed total", () => {
    const usage = {
      promptTokens: 10927,
      completionTokens: 171,
      totalTokens: 11098,
    };

    const honest = calculateHonestTokenBreakdown(usage);

    expect(honest.completion).toBe(171);
    expect(honest.prompt).toBe(10927);
  });

  it("displayed total equals completion-side breakdown sum when breakdown is available", () => {
    const usage = {
      promptTokens: 1000,
      completionTokens: 300,
      totalTokens: 1300,
      reasoningTokens: 100,
      toolTokens: 50,
    };

    const honest = calculateHonestTokenBreakdown(usage);

    expect(honest.completion).toBe(300);
    expect(honest.breakdown.reasoning).toBe(100);
    expect(honest.breakdown.tools).toBe(50);
    expect(honest.breakdown.output).toBe(150);
    expect(honest.breakdown.completion).toBeUndefined();
  });

  it("missing provider breakdown does not produce fake counts (uses completion category)", () => {
    const usage = {
      promptTokens: 1000,
      completionTokens: 300,
      totalTokens: 1300,
    };

    const honest = calculateHonestTokenBreakdown(usage);

    expect(honest.completion).toBe(300);
    expect(honest.breakdown.reasoning).toBe(0);
    expect(honest.breakdown.tools).toBe(0);
    expect(honest.breakdown.output).toBe(0);
    expect(honest.breakdown.completion).toBe(300);
  });

  it("handles inconsistent total/prompt/completion from provider gracefully", () => {
    const usage = {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1300,
    };

    const honest = calculateHonestTokenBreakdown(usage);

    expect(honest.completion).toBe(300);
  });
});
