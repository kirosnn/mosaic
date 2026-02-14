import { estimateTokensFromText, estimateTokensForContent } from "../../utils/tokenEstimator";
import type { Message } from "./types";

export type CompactableMessage = Pick<Message, "role" | "content" | "thinkingContent" | "toolName">;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + "...";
}

export function estimateTokensForMessage(message: CompactableMessage): number {
  return estimateTokensForContent(message.content || "", message.thinkingContent || undefined);
}

export function estimateTokensForMessages(messages: CompactableMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokensForMessage(message), 0);
}

export function estimateTotalTokens(messages: CompactableMessage[], systemPrompt: string): number {
  const systemTokens = estimateTokensFromText(systemPrompt) + 8;
  return systemTokens + estimateTokensForMessages(messages);
}

export function shouldAutoCompact(totalTokens: number, maxContextTokens: number): boolean {
  if (!Number.isFinite(maxContextTokens) || maxContextTokens <= 0) return false;
  const threshold = Math.floor(maxContextTokens * 0.95);
  return totalTokens >= threshold;
}

export function summarizeMessage(message: CompactableMessage, isLastUser: boolean, isFirstUser: boolean = false): string {
  if (message.role === "tool") {
    const name = message.toolName || "tool";
    const text = message.content || "";
    const isError = text.toLowerCase().includes('error') || text.toLowerCase().includes('failed');
    const status = isError ? 'FAILED' : 'OK';
    const cleaned = normalizeWhitespace(text);
    const toolLimit = name === 'plan' ? 600 : (name === 'glob' || name === 'grep' || name === 'read') ? 300 : 120;
    return `[tool:${name} ${status}] ${truncateText(cleaned, toolLimit)}`;
  }

  if (message.role === "assistant") {
    const cleaned = normalizeWhitespace(message.content || "");
    const sentenceMatch = cleaned.match(/^[^.!?\n]{10,}[.!?]/);
    const summary = sentenceMatch ? sentenceMatch[0] : cleaned;
    return `assistant: ${truncateText(summary, 200)}`;
  }

  const cleaned = normalizeWhitespace(message.content || "");
  const limit = (isLastUser || isFirstUser) ? cleaned.length : 400;
  return `user: ${truncateText(cleaned, limit)}`;
}

export function buildSummary(messages: CompactableMessage[], maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 3);
  let charCount = 0;
  const lines: string[] = [];

  let lastUserIndex = -1;
  let firstUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') { lastUserIndex = i; break; }
  }
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === 'user') { firstUserIndex = i; break; }
  }

  for (let i = 0; i < messages.length; i++) {
    if (charCount >= maxChars) break;
    const line = `- ${summarizeMessage(messages[i]!, i === lastUserIndex, i === firstUserIndex)}`;
    charCount += line.length + 1;
    lines.push(line);
  }

  const full = lines.join("\n").trim();
  return truncateText(full, maxChars);
}

export function collectContextFiles(messages: Message[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    if (!message.toolArgs) continue;
    const toolName = message.toolName || "";
    if (!["read", "write", "edit", "list", "grep"].includes(toolName)) continue;
    const path = message.toolArgs.path;
    if (typeof path === "string" && path.trim()) {
      files.add(path.trim());
    }
    const pattern = message.toolArgs.pattern;
    if (toolName === "grep" && typeof pattern === "string" && pattern.trim()) {
      files.add(pattern.trim());
    }
  }
  return Array.from(files.values()).sort((a, b) => a.localeCompare(b));
}

export function appendContextFiles(summary: string, files: string[], maxTokens: number): string {
  if (files.length === 0) return summary;
  const maxChars = Math.max(0, maxTokens * 4);
  const list = files.map(f => `- ${f}`).join("\n");
  const block = `\n\nFiles kept after compaction:\n${list}`;
  return truncateText(`${summary}${block}`, maxChars);
}

export function compactMessagesForUi(
  messages: Message[],
  systemPrompt: string,
  maxContextTokens: number,
  createId: () => string,
  summaryOnly: boolean
): { messages: Message[]; estimatedTokens: number; didCompact: boolean } {
  const systemTokens = estimateTokensFromText(systemPrompt) + 8;
  const totalTokens = systemTokens + estimateTokensForMessages(messages);
  if (totalTokens <= maxContextTokens && !summaryOnly) {
    return { messages, estimatedTokens: totalTokens - systemTokens, didCompact: false };
  }

  const summaryTokens = Math.min(2000, Math.max(400, Math.floor(maxContextTokens * 0.2)));
  const recentBudget = Math.max(500, maxContextTokens - summaryTokens);

  let recentTokens = 0;
  const recent: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const msgTokens = estimateTokensForMessage(message);
    if (recentTokens + msgTokens > recentBudget && recent.length > 0) break;
    recent.unshift(message);
    recentTokens += msgTokens;
  }

  const cutoff = messages.length - recent.length;
  const older = cutoff > 0 ? messages.slice(0, cutoff) : [];
  const files = collectContextFiles(messages);
  const summaryBase = buildSummary(summaryOnly ? messages : (older.length > 0 ? older : messages), summaryTokens);
  const summary = appendContextFiles(summaryBase, files, summaryTokens);
  const summaryMessage: Message = {
    id: createId(),
    role: "assistant",
    content: summary
  };

  const nextMessages = summaryOnly ? [summaryMessage] : [summaryMessage, ...recent];
  const estimatedTokens = estimateTokensForMessages(nextMessages);
  return { messages: nextMessages, estimatedTokens, didCompact: true };
}
