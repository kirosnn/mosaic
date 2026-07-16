import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import defaultPolicy from "./defaultPolicy.json";

export type AgentPolicy = typeof defaultPolicy;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePolicy<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) return (override ?? base) as T;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value)
      ? mergePolicy(current, value)
      : value;
  }
  return merged as T;
}

export function getAgentPolicy(): AgentPolicy {
  const configuredPath = process.env.MOSAIC_AGENT_POLICY?.trim();
  const path = resolve(configuredPath || ".mosaic/agent-policy.json");
  if (!existsSync(path)) return defaultPolicy;
  try {
    const override = JSON.parse(readFileSync(path, "utf8"));
    return mergePolicy(defaultPolicy, override);
  } catch {
    return defaultPolicy;
  }
}

export function compilePolicyPattern(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}
