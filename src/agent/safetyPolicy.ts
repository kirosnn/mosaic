import { compilePolicyPattern, getAgentPolicy } from "./policyConfig";

export function getDeterministicSafetyRefusal(userMessage: string): string | null {
  const normalized = userMessage.replace(/\s+/g, " ").trim();
  const policy = getAgentPolicy().safety;
  const patterns = Object.fromEntries(
    Object.entries(policy.patterns).map(([name, pattern]) => [
      name,
      compilePolicyPattern(pattern),
    ]),
  );
  const harmful = policy.rules.some((rule) =>
    rule.every((patternName) => patterns[patternName]?.test(normalized)),
  );
  if (!harmful) return null;

  return policy.responses.find((response) =>
    compilePolicyPattern(response.pattern).test(normalized),
  )?.message ?? policy.defaultResponse;
}
