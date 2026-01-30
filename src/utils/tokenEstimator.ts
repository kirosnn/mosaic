const CODE_CHARS = /[{}()\[\]=<>:;]/g;
const CODE_DENSITY_THRESHOLD = 0.04;

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  const matches = text.match(CODE_CHARS);
  const density = matches ? matches.length / text.length : 0;
  const ratio = density >= CODE_DENSITY_THRESHOLD ? 2.8 : 3.3;
  return Math.ceil(text.length / ratio);
}

export function estimateTokensForContent(content: string, thinkingContent?: string): number {
  const contentTokens = estimateTokensFromText(content);
  const thinkingTokens = thinkingContent ? estimateTokensFromText(thinkingContent) : 0;
  return contentTokens + thinkingTokens + 4;
}

const CONTEXT_BUDGETS: Record<string, number> = {
  anthropic: 180000,
  openai: 115000,
  google: 900000,
  mistral: 28000,
  xai: 117000,
  ollama: 7000,
};

const DEFAULT_BUDGET = 12000;

export function getDefaultContextBudget(provider?: string): number {
  if (!provider) return DEFAULT_BUDGET;
  return CONTEXT_BUDGETS[provider] ?? DEFAULT_BUDGET;
}
