import type { ChatMessage } from "./types";

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
}

export function normalizeRelative(relativePath: string): string {
  const normalized = (relativePath || "").replace(/\\/g, "/");
  if (!normalized || normalized === "." || normalized === "./") return "";
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  try {
    const value = JSON.stringify(args);
    if (value.length <= 100) return value;
    return `${value.slice(0, 97)}...`;
  } catch {
    return "";
  }
}

export function buildAgentHistory(messages: ChatMessage[]): Array<{
  role: string;
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
}> {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "tool")
    .map((message) => ({
      role: message.role,
      content: message.content,
      toolName: message.toolName,
      toolArgs: message.toolArgs,
      toolResult: message.toolResult,
      success: message.success,
    }))
    .filter((message) => {
      if (message.role === "user" || message.role === "assistant") return Boolean(message.content.trim());
      return true;
    });
}
