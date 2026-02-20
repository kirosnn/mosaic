import { estimateTokensFromText, estimateTokensForContent } from "../../utils/tokenEstimator";
import type { Message } from "./types";

export type CompactableMessage = Pick<Message, "role" | "content" | "thinkingContent" | "toolName">;

export type CompactionDisplayMode = "auto" | "manual";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0.00";
  return ((part / total) * 100).toFixed(2);
}

function buildUsageBarSegments(used: number, buffer: number, total: number, width: number): { usedCells: number; bufferCells: number; freeCells: number } {
  if (!Number.isFinite(total) || total <= 0 || width <= 0) {
    return { usedCells: 0, bufferCells: 0, freeCells: Math.max(0, width) };
  }
  const usedRatio = clampNumber(used / total, 0, 1);
  const bufferRatio = clampNumber(buffer / total, 0, 1);
  let usedCells = Math.round(usedRatio * width);
  let bufferCells = Math.round(bufferRatio * width);
  if (usedCells + bufferCells > width) {
    const overflow = usedCells + bufferCells - width;
    if (bufferCells >= overflow) {
      bufferCells -= overflow;
    } else {
      usedCells = Math.max(0, usedCells - (overflow - bufferCells));
      bufferCells = 0;
    }
  }
  const freeCells = Math.max(0, width - usedCells - bufferCells);
  return { usedCells, bufferCells, freeCells };
}

export function buildCompactionDisplay(
  mode: CompactionDisplayMode,
  usedTokens: number,
  maxContextTokens: number,
  compactedTokens: number
): string {
  const thresholdTokens = Math.floor(maxContextTokens * 0.95);
  const bufferTokens = Math.max(0, maxContextTokens - thresholdTokens);
  const usedForBar = Math.min(maxContextTokens, usedTokens);
  const effectiveBuffer = Math.max(0, Math.min(bufferTokens, maxContextTokens - usedForBar));
  const bar = buildUsageBarSegments(usedForBar, effectiveBuffer, maxContextTokens, 40);
  const reclaimedTokens = Math.max(0, usedTokens - compactedTokens);
  const overflowTokens = Math.max(0, usedTokens - maxContextTokens);
  const title = mode === "auto" ? "Auto Compaction" : "Compaction";
  const lines: string[] = [];
  lines.push(`[CTX_HEADER]|${title}`);
  lines.push(`[CTX_BAR]|${bar.usedCells}|${bar.bufferCells}|${bar.freeCells}|${formatPercent(usedForBar, maxContextTokens)}`);
  lines.push("[CTX_SECTION]|Compaction summary");
  lines.push(`[CTX_CAT|MS]|Before compaction|${formatCompactTokens(usedTokens)}|${formatPercent(usedTokens, maxContextTokens)}`);
  lines.push(`[CTX_CAT|AB]|Trigger threshold (95%)|${formatCompactTokens(thresholdTokens)}|${formatPercent(thresholdTokens, maxContextTokens)}`);
  lines.push(`[CTX_CAT|UP]|After compaction|${formatCompactTokens(compactedTokens)}|${formatPercent(compactedTokens, maxContextTokens)}`);
  lines.push(`[CTX_CAT|FS]|Tokens reclaimed|${formatCompactTokens(reclaimedTokens)}|${formatPercent(reclaimedTokens, maxContextTokens)}`);
  if (mode === "auto") {
    if (overflowTokens > 0) {
      lines.push(`[CTX_NOTE]|Compaction triggered above max context by ${formatCompactTokens(overflowTokens)} tokens.`);
    } else {
      lines.push("[CTX_NOTE]|Compaction triggered near the context limit.");
    }
  } else {
    lines.push("[CTX_NOTE]|Compaction requested manually.");
  }
  lines.push("[CTX_NOTE]|Run /context for full diagnostics.");
  return lines.join("\n");
}

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

export function shouldHideFromCompactionSummary(message: CompactableMessage): boolean {
  const text = (message.content || "").trimStart();
  if (message.role === "user") {
    return /^FORCED SKILL INVOCATION\b/i.test(text);
  }
  if (message.role === "tool") {
    const toolName = (message.toolName || "").toLowerCase();
    return toolName === "title" || toolName === "plan";
  }
  if (message.role === "assistant") {
    if (/^running\b/i.test(text)) return true;
    if (/^api error\b/i.test(text)) return true;
  }
  return false;
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
    if (shouldHideFromCompactionSummary(messages[i]!)) continue;
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
  summaryOnly: boolean,
  knownFiles?: string[]
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
  const contextFiles = collectContextFiles(messages);
  const allFiles = knownFiles
    ? [...new Set([...contextFiles, ...knownFiles])].sort((a, b) => a.localeCompare(b))
    : contextFiles;
  const summaryBase = buildSummary(summaryOnly ? messages : (older.length > 0 ? older : messages), summaryTokens);
  const summary = appendContextFiles(summaryBase, allFiles, summaryTokens);
  const summaryMessage: Message = {
    id: createId(),
    role: "assistant",
    content: summary
  };

  const nextMessages = summaryOnly ? [summaryMessage] : [summaryMessage, ...recent];
  const estimatedTokens = estimateTokensForMessages(nextMessages);
  return { messages: nextMessages, estimatedTokens, didCompact: true };
}
