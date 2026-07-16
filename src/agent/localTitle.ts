import { compilePolicyPattern, getAgentPolicy } from "./policyConfig";

function normalizeTitleText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function limitAtWord(value: string, maxLength: number, boundaryRatio: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength + 1);
  const boundary = sliced.lastIndexOf(" ");
  return (boundary >= Math.floor(maxLength * boundaryRatio)
    ? sliced.slice(0, boundary)
    : value.slice(0, maxLength)
  ).trimEnd();
}

export function generateLocalTitle(userMessage: string): string {
  const policy = getAgentPolicy().title;
  let normalized = normalizeTitleText(userMessage);
  for (const pattern of policy.leadingNoisePatterns) {
    normalized = normalized.replace(compilePolicyPattern(pattern), "").trim();
  }
  if (!normalized) return policy.emptyTitle;

  for (const greeting of policy.greetings) {
    if (compilePolicyPattern(greeting.pattern).test(normalized)) {
      return greeting.title;
    }
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  const withoutTrailingPunctuation = firstSentence.replace(/[.!?;:,]+$/g, "").trim();
  const title = limitAtWord(
    withoutTrailingPunctuation || normalized,
    policy.maxLength,
    policy.wordBoundaryRatio,
  );
  if (!title) {
    return policy.languageFallbacks.find((fallback) =>
      compilePolicyPattern(fallback.pattern).test(normalized),
    )?.title ?? policy.emptyTitle;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}
