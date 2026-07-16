import { getAgentPolicy } from "./policyConfig";

type OperationArgs = Record<string, unknown>;

const deniedExact = new Set<string>();
const deniedTargets = new Set<string>();

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  const ignoredKeys = new Set(getAgentPolicy().deniedOperations.ignoredArgumentKeys);
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (ignoredKeys.has(key)) continue;
    result[key] = normalizeValue((value as Record<string, unknown>)[key]);
  }
  return result;
}

function exactKey(toolName: string, args: OperationArgs): string {
  return `${toolName}:${JSON.stringify(normalizeValue(args))}`;
}

function targetKey(toolName: string, args: OperationArgs): string | null {
  const policy = getAgentPolicy().deniedOperations;
  const commandArgument = policy.commandTools[toolName as keyof typeof policy.commandTools];
  if (commandArgument && typeof args[commandArgument] === "string") {
    return `${toolName}:${(args[commandArgument] as string).replace(/\s+/g, " ").trim()}`;
  }
  const pathValue = args[policy.pathArgument];
  if (typeof pathValue === "string") {
    return `${toolName}:${pathValue.replace(/\\/g, "/").toLowerCase()}`;
  }
  return null;
}

export function beginOperationTurn(): void {
  deniedExact.clear();
  deniedTargets.clear();
}

export function recordDeniedOperation(toolName: string, args: OperationArgs): void {
  deniedExact.add(exactKey(toolName, args));
  const target = targetKey(toolName, args);
  if (target) deniedTargets.add(target);
}

export function isOperationDenied(toolName: string, args: OperationArgs): boolean {
  if (deniedExact.has(exactKey(toolName, args))) return true;
  const target = targetKey(toolName, args);
  return target ? deniedTargets.has(target) : false;
}

export function getDeniedOperationMessages(toolName: string): {
  error: string;
  userMessage: string;
} {
  const policy = getAgentPolicy().deniedOperations;
  return {
    error: policy.blockedError.replace("{toolName}", toolName),
    userMessage: policy.blockedUserMessage,
  };
}
