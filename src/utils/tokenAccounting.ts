
export interface TokenBreakdown {
  prompt: number;
  reasoning: number;
  output: number;
  tools: number;
  completion?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  toolTokens?: number;
}

export function calculateHonestTokenBreakdown(usage: Usage) {
  const prompt = Math.max(0, usage.promptTokens);
  const completion = Math.max(0, usage.completionTokens || (usage.totalTokens - prompt));
  
  let reasoning = 0;
  let tools = 0;
  let output = 0;
  let completionOnly: number | undefined = undefined;

  const hasProviderBreakdown = usage.reasoningTokens !== undefined || usage.toolTokens !== undefined;

  if (hasProviderBreakdown) {
    reasoning = usage.reasoningTokens ?? 0;
    tools = usage.toolTokens ?? 0;
    output = Math.max(0, completion - reasoning - tools);
  } else {
    // Requirement: If no provider breakdown, do not invent numbers.
    completionOnly = completion;
  }

  return {
    prompt,
    completion,
    total: usage.totalTokens,
    breakdown: {
      prompt,
      reasoning,
      tools,
      output,
      completion: completionOnly
    } as TokenBreakdown
  };
}
