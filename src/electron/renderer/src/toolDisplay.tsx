import React from "react";
import type { ChatMessage } from "./types";

function normalizeToolName(toolName?: string): string {
  if (!toolName) return "tool";
  return String(toolName).trim().toLowerCase();
}

function titleCaseWords(input: string): string {
  return input
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncate(value: string, maxLength = 58): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function pickInfoValue(args?: Record<string, unknown>): string {
  if (!args) return "";
  const preferredKeys = ["path", "pattern", "query", "title", "command", "cmd", "url", "file", "name"];
  for (const key of preferredKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return truncate(value.trim());
  }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.trim()) {
      return truncate(`${key}: ${value.trim()}`);
    }
  }
  return "";
}

function parseListLikeResult(result: unknown): number | null {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    const maybeFiles = (result as Record<string, unknown>).files;
    if (Array.isArray(maybeFiles)) return maybeFiles.length;
  }
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parseListLikeResult(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function getTitleFromToolData(message: ChatMessage): string {
  const argsTitle = typeof message.toolArgs?.title === "string" ? message.toolArgs.title.trim() : "";
  if (argsTitle) return argsTitle;
  if (message.toolResult && typeof message.toolResult === "object") {
    const resultObj = message.toolResult as Record<string, unknown>;
    const resultTitle = typeof resultObj.title === "string" ? resultObj.title.trim() : "";
    if (resultTitle) return resultTitle;
  }
  const content = message.content?.trim() ?? "";
  if (content) return content;
  return "Completed";
}

function getQuestionSummary(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const obj = result as Record<string, unknown>;
  if (typeof obj.customText === "string" && obj.customText.trim()) return obj.customText.trim();
  if (typeof obj.label === "string" && obj.label.trim()) return obj.label.trim();
  if (typeof obj.value === "string" && obj.value.trim()) return obj.value.trim();
  return "";
}

function getFirstLine(value: string): string {
  const line = value.split(/\r?\n/).find((entry) => entry.trim());
  return line ? line.trim() : "";
}

export function isCompactTool(toolName?: string): boolean {
  const name = normalizeToolName(toolName);
  if (name.startsWith("mcp__")) return true;
  return name === "read"
    || name === "list"
    || name === "grep"
    || name === "glob"
    || name === "fetch"
    || name === "title"
    || name === "question"
    || name === "abort"
    || name === "review";
}

export function getToolLabel(toolName?: string): string {
  const name = normalizeToolName(toolName);
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    const tail = parts[parts.length - 1] || "tool";
    return `MCP ${titleCaseWords(tail)}`;
  }
  return titleCaseWords(name);
}

export function getToolInfo(args?: Record<string, unknown>): string {
  return pickInfoValue(args);
}

export function getToolStateLabel(message: ChatMessage): string {
  if (message.running) return "running";
  if (message.success === false) return "failed";
  return "done";
}

export function getToolStateClassName(message: ChatMessage): string {
  if (message.running) return "running";
  if (message.success === false) return "error";
  return "ok";
}

export function getCompactToolResult(message: ChatMessage): string {
  const name = normalizeToolName(message.toolName);
  if (message.running) return "running...";
  if (name === "title") return getTitleFromToolData(message);
  if (name === "read") {
    if (typeof message.toolResult === "string") {
      const lines = message.toolResult ? message.toolResult.split(/\r?\n/).length : 0;
      return `Read ${lines} lines`;
    }
  }
  if (name === "glob" || name === "list" || name === "grep") {
    const count = parseListLikeResult(message.toolResult);
    if (typeof count === "number") return `${count} results`;
  }
  if (name === "question") {
    const questionSummary = getQuestionSummary(message.toolResult);
    if (questionSummary) return questionSummary;
    return "Selected";
  }
  if (name === "abort" || name === "review") {
    const firstLine = getFirstLine(message.content || "");
    return firstLine || "Interrupted";
  }
  const firstLine = getFirstLine(message.content || "");
  if (firstLine) return firstLine;
  return "Completed";
}

function iconSvg(path: React.ReactNode): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

export function renderToolIcon(toolName?: string): React.ReactNode {
  const name = normalizeToolName(toolName);
  if (name === "read") return iconSvg(<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /><path d="M6 8h2" /><path d="M6 12h2" /><path d="M16 8h2" /><path d="M16 12h2" /></>);
  if (name === "write") return iconSvg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
  if (name === "edit") return iconSvg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
  if (name === "bash") return iconSvg(<><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></>);
  if (name === "grep") return iconSvg(<><path d="m13 13.5 2-2.5-2-2.5" /><path d="m21 21-4.3-4.3" /><path d="M9 8.5 7 11l2 2.5" /><circle cx="11" cy="11" r="8" /></>);
  if (name === "glob") return iconSvg(<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /><circle cx="15" cy="13" r="3" /><path d="m17 15 2 2" /></>);
  if (name === "list") return iconSvg(<><path d="M21 12h-8" /><path d="M21 6H8" /><path d="M21 18h-8" /><path d="M12 12h-4" /><path d="M12 18h-4" /><path d="M3 6v4c0 1.1.9 2 2 2h3" /><path d="M3 10v6c0 1.1.9 2 2 2h3" /></>);
  if (name === "fetch") return iconSvg(<><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>);
  if (name === "plan") return iconSvg(<><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>);
  if (name === "question") return iconSvg(<><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>);
  if (name === "title") return iconSvg(<><path d="M6 12h12" /><path d="M6 20V4" /><path d="M18 20V4" /></>);
  if (name === "review") return iconSvg(<><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" /><polyline points="14 2 14 8 20 8" /><path d="m3 15 2 2 4-4" /></>);
  if (name === "abort") return iconSvg(<><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" /><line x1="15" x2="9" y1="9" y2="15" /><line x1="9" x2="15" y1="9" y2="15" /></>);
  if (name === "explore") return iconSvg(<><path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44" /><path d="m13.56 11.747 4.332-.924" /><path d="m16 21-3.105-6.21" /><path d="M16.485 5.33 20.6 9.44a1.07 1.07 0 0 1 0 1.512l-3.113 3.113a.934.934 0 0 1-1.32 0l-4.227-4.227a1.07 1.07 0 0 1 0-1.512l3.113-3.113a.934.934 0 0 1 1.432-.001z" /><path d="M3.3 17 5 15.3" /><path d="m20.8 14.2 1.7-1.7" /></>);
  if (name.startsWith("mcp__")) return iconSvg(<><path d="M9 2v6" /><path d="M15 2v6" /><path d="M12 17v5" /><path d="M5 8h14" /><path d="M6 11V8h12v3a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6Z" /></>);
  return iconSvg(<><path d="m14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></>);
}
