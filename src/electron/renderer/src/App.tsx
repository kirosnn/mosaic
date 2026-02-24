import React, { Profiler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { EditorPanel, type HighlightedCodeSelection } from "./components/EditorPanel";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { UsagePanel } from "./components/UsagePanel";
import { getLogoSrc, getThemeLabel } from "./constants";
import { getMediaKind } from "./mediaPreview";
import { applyCommandCompletion, computeCommandCompletions, type CommandCompletionItem } from "./commandCompletion";
import type {
  AgentEvent,
  ChatMessage,
  CommandCatalogResponse,
  DesktopCommandContext,
  DesktopConversationHistory,
  DesktopConversationStep,
  EditorStatus,
  FsEntry,
  Theme,
  UsageReport,
} from "./types";
import { buildAgentHistory, createId, normalizeRelative, stringifyValue, summarizeArgs } from "./utils";

const api = window.mosaicDesktop;
type PendingToolCall = {
  toolId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
};
const COMMAND_CATALOG_TTL_MS = 5000;
const COMMAND_COMPLETION_DEBOUNCE_MS = 70;
const FS_CHANGE_DEBOUNCE_MS = 140;
const FS_CHANGE_FULL_REFRESH_TOKEN = "__full__";
const CHAT_AUTO_SCROLL_NEAR_BOTTOM_PX = 120;
const PERF_LOG_INTERVAL_MS = 10_000;
const PERF_SAMPLE_LIMIT = 240;

function createEmptyHighlightedCode(): HighlightedCodeSelection {
  return {
    lineNumbers: [],
  };
}

function sanitizeHighlightedLineNumbers(lineNumbers: number[], lineCount: number): number[] {
  if (lineCount <= 0) return [];
  return Array.from(new Set(lineNumbers))
    .filter((lineNumber) => Number.isInteger(lineNumber) && lineNumber > 0 && lineNumber <= lineCount)
    .sort((a, b) => a - b);
}

function buildPromptWithHighlightedCode(
  prompt: string,
  currentFile: string,
  editorValue: string,
  highlightedCode: HighlightedCodeSelection,
): string {
  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) return "";
  if (!currentFile || !editorValue || highlightedCode.lineNumbers.length === 0) return normalizedPrompt;

  const contentLines = editorValue.split(/\r?\n/);
  const validLines = sanitizeHighlightedLineNumbers(highlightedCode.lineNumbers, contentLines.length);
  if (validLines.length === 0) return normalizedPrompt;

  const sections: string[] = [];
  let startLine = validLines[0]!;
  let endLine = validLines[0]!;

  const pushSection = () => {
    const label = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
    const content = contentLines.slice(startLine - 1, endLine).join("\n");
    sections.push(`${label}\n\`\`\`\n${content}\n\`\`\``);
  };

  for (let index = 1; index < validLines.length; index += 1) {
    const current = validLines[index]!;
    if (current === endLine + 1) {
      endLine = current;
      continue;
    }
    pushSection();
    startLine = current;
    endLine = current;
  }

  pushSection();

  return `${normalizedPrompt}\n\nSelected code from ${currentFile}:\n${sections.join("\n\n")}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index] ?? 0;
}

function shouldShowRunningTool(toolName: string): boolean {
  return toolName === "explore" || toolName.startsWith("mcp__");
}

type DesktopErrorContext = {
  source?: string;
  provider?: string;
  model?: string;
};

function normalizeErrorDetail(input: string): string {
  const value = String(input || "").replace(/\s+/g, " ").trim();
  if (value.length <= 260) return value;
  return `${value.slice(0, 257)}...`;
}

function buildDesktopErrorScope(context?: DesktopErrorContext): string {
  const source = String(context?.source || "").trim().toLowerCase();
  const provider = String(context?.provider || "").trim();
  const model = String(context?.model || "").trim();

  if (source === "provider" || provider || model) {
    if (provider && model) return `Provider: ${provider} (${model})`;
    if (provider) return `Provider: ${provider}`;
    if (model) return `Provider model: ${model}`;
    return "Provider";
  }

  if (source === "backend") return "Mosaic backend";
  if (source === "runtime") return "Mosaic runtime";
  return "Mosaic";
}

function formatDesktopError(errorMessage: string, context?: DesktopErrorContext): string {
  const detail = normalizeErrorDetail(errorMessage);
  const scope = buildDesktopErrorScope(context);
  const lower = detail.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429")) {
    return `${scope}\nRate limit exceeded. Wait a moment and retry.\nDetails: ${detail}`;
  }

  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("invalid api key")) {
    return `${scope}\nAuthentication failed. Check your API key and model access.\nDetails: ${detail}`;
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return `${scope}\nRequest timed out. Retry or reduce request size.\nDetails: ${detail}`;
  }

  if (lower.includes("network") || lower.includes("connection") || lower.includes("econnrefused")) {
    return `${scope}\nNetwork connection failed.\nDetails: ${detail}`;
  }

  if (lower.includes("context length") || lower.includes("too long") || lower.includes("max tokens")) {
    return `${scope}\nContext limit exceeded. Reduce prompt size and retry.\nDetails: ${detail}`;
  }

  return `${scope}\n${detail}`;
}

interface ConversationHistoryItem {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  workspaceRoot: string | null;
  messages: ChatMessage[];
}

interface RecentWorkspaceItem {
  path: string;
  updatedAt: number;
}

function collapseWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function getMessageDisplayContent(message: ChatMessage): string {
  if (message.role === "user") {
    return collapseWhitespace(message.displayContent || message.content);
  }
  return collapseWhitespace(message.content);
}

function hasConversationContent(messages: ChatMessage[]): boolean {
  return messages.some((message) => Boolean(getMessageDisplayContent(message)));
}

function buildDefaultConversationTitle(timestamp = Date.now()): string {
  void timestamp;
  return "New chat";
}

function formatDisplayPath(workspaceRoot: string, currentFile: string): string {
  const homePath = String(process.env.USERPROFILE || process.env.HOME || "").replace(/\\/g, "/");
  const normalizedWorkspace = String(workspaceRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedFile = String(currentFile || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const fullPath = normalizedFile ? `${normalizedWorkspace}/${normalizedFile}` : normalizedWorkspace;
  if (!fullPath) return "~";

  let pathForDisplay = fullPath;
  if (homePath) {
    const lowerPath = fullPath.toLowerCase();
    const lowerHome = homePath.toLowerCase();
    if (lowerPath === lowerHome || lowerPath.startsWith(`${lowerHome}/`)) {
      pathForDisplay = `~${fullPath.slice(homePath.length)}`;
    }
  }

  const isHome = pathForDisplay.startsWith("~");
  const startsWithSlash = pathForDisplay.startsWith("/");
  const segments = pathForDisplay.split("/").filter(Boolean);
  let prefix = "";
  let bodySegments = segments;

  if (isHome) {
    prefix = "~";
  } else if (segments[0] && /^[A-Za-z]:$/.test(segments[0])) {
    prefix = segments[0];
    bodySegments = segments.slice(1);
  } else if (startsWithSlash) {
    prefix = "/";
  }

  const tail = bodySegments.slice(-3);
  if (tail.length === 0) {
    return prefix || "~";
  }
  if (!prefix) {
    return tail.join("/");
  }
  if (prefix === "/") {
    return `/${tail.join("/")}`;
  }
  return `${prefix}/${tail.join("/")}`;
}

function getParentPath(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return "";
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  return normalized.slice(0, index);
}

function getBaseName(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return "";
  const index = normalized.lastIndexOf("/");
  if (index < 0) return normalized;
  return normalized.slice(index + 1);
}

function getTimestampFromMessageId(messageId: string, fallbackTimestamp: number): number {
  const parts = String(messageId || "").split("-");
  const candidate = Number(parts[1]);
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.floor(candidate);
  }
  return fallbackTimestamp;
}

function toHistorySteps(messages: ChatMessage[]): DesktopConversationStep[] {
  const now = Date.now();
  const steps: DesktopConversationStep[] = [];
  let sequence = 0;

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool" && message.role !== "system" && message.role !== "error") {
      continue;
    }
    const content = String(message.content || "");
    if (!content.trim() && message.role !== "tool") {
      continue;
    }
    const stepType = message.role === "error" ? "system" : message.role;
    const timestamp = getTimestampFromMessageId(message.id, now + sequence);
    const step: DesktopConversationStep = {
      type: stepType,
      content,
      timestamp,
    };
    if (message.role === "user" && typeof message.displayContent === "string" && message.displayContent.trim()) {
      step.displayContent = message.displayContent;
    }
    if (message.role === "tool") {
      if (typeof message.toolName === "string") {
        step.toolName = message.toolName;
      }
      if (message.toolArgs && typeof message.toolArgs === "object") {
        step.toolArgs = message.toolArgs;
      }
      if (Object.prototype.hasOwnProperty.call(message, "toolResult")) {
        step.toolResult = message.toolResult;
      }
      if (typeof message.success === "boolean") {
        step.success = message.success;
      }
    }
    if (message.role === "error" || (message.role === "system" && message.isError === true)) {
      step.success = false;
    }
    steps.push(step);
    sequence += 1;
  }

  return steps;
}

function toChatMessages(steps: DesktopConversationStep[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || (step.type !== "user" && step.type !== "assistant" && step.type !== "tool" && step.type !== "system")) {
      continue;
    }
    const timestamp = Number.isFinite(Number(step.timestamp)) ? Number(step.timestamp) : Date.now() + index;
    const id = `${step.type}-${Math.floor(timestamp)}-${index}`;
    if (step.type === "user") {
      const content = String(step.content || "");
      const displayContent = typeof step.displayContent === "string" && step.displayContent.trim()
        ? String(step.displayContent)
        : content;
      messages.push({
        id,
        role: "user",
        content,
        displayContent,
      });
      continue;
    }
    if (step.type === "assistant") {
      messages.push({
        id,
        role: "assistant",
        content: String(step.content || ""),
      });
      continue;
    }
    if (step.type === "tool") {
      messages.push({
        id,
        role: "tool",
        content: String(step.content || ""),
        running: false,
        toolName: typeof step.toolName === "string" ? step.toolName : undefined,
        toolArgs: step.toolArgs && typeof step.toolArgs === "object" ? step.toolArgs : undefined,
        toolResult: step.toolResult,
        success: typeof step.success === "boolean" ? step.success : undefined,
      });
      continue;
    }
    const isError = step.success === false;
    messages.push({
      id,
      role: isError ? "error" : "system",
      content: String(step.content || ""),
      isError,
    });
  }
  return messages;
}

function resolveConversationTitle(conversation: DesktopConversationHistory, fallbackTimestamp: number): string {
  const fallbackTitle = buildDefaultConversationTitle(fallbackTimestamp);
  const normalizedTitle = collapseWhitespace(typeof conversation.title === "string" ? conversation.title : "");
  if (!normalizedTitle) return fallbackTitle;
  if (conversation.titleEdited === true) return normalizedTitle;

  const firstUserStep = Array.isArray(conversation.steps)
    ? conversation.steps.find((step) => step?.type === "user")
    : undefined;
  const firstUserLabel = collapseWhitespace(
    String(firstUserStep?.displayContent || firstUserStep?.content || ""),
  );
  if (firstUserLabel && normalizedTitle === firstUserLabel) {
    return fallbackTitle;
  }
  return normalizedTitle;
}

function toConversationHistoryItem(conversation: DesktopConversationHistory): ConversationHistoryItem {
  const messages = toChatMessages(conversation.steps || []);
  const timestamp = Number.isFinite(Number(conversation.timestamp)) ? Number(conversation.timestamp) : Date.now();
  const workspaceValue = typeof conversation.workspace === "string" ? conversation.workspace.trim() : "";
  return {
    id: conversation.id,
    title: resolveConversationTitle(conversation, timestamp),
    updatedAt: timestamp,
    messageCount: messages.length,
    workspaceRoot: workspaceValue || null,
    messages,
  };
}

function serializeComparableValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function areHistoryStepsEquivalent(left: DesktopConversationStep[], right: DesktopConversationStep[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (String(a.content || "") !== String(b.content || "")) return false;
    if (String(a.displayContent || "") !== String(b.displayContent || "")) return false;
    if (String(a.toolName || "") !== String(b.toolName || "")) return false;
    if (serializeComparableValue(a.toolArgs) !== serializeComparableValue(b.toolArgs)) return false;
    if (serializeComparableValue(a.toolResult) !== serializeComparableValue(b.toolResult)) return false;
    if ((typeof a.success === "boolean" ? a.success : null) !== (typeof b.success === "boolean" ? b.success : null)) return false;
  }
  return true;
}

function areConversationMessagesEquivalent(left: ChatMessage[], right: ChatMessage[]): boolean {
  const leftSteps = toHistorySteps(left);
  const rightSteps = toHistorySteps(right);
  return areHistoryStepsEquivalent(leftSteps, rightSteps);
}

function areFsEntriesEquivalent(left: FsEntry[] | undefined, right: FsEntry[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (!leftEntry || !rightEntry) return false;
    if (leftEntry.name !== rightEntry.name) return false;
    if (leftEntry.relativePath !== rightEntry.relativePath) return false;
    if (leftEntry.type !== rightEntry.type) return false;
  }
  return true;
}

export function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const platform = useMemo(() => {
    if (api && typeof api.getPlatform === "function") return api.getPlatform();
    return "unknown";
  }, []);

  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [directoryCache, setDirectoryCache] = useState<Record<string, FsEntry[]>>({});
  const directoryCacheRef = useRef<Record<string, FsEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set([""]));
  const openDirectoriesRef = useRef<Set<string>>(new Set([""]));

  const [currentFile, setCurrentFile] = useState("");
  const [editorValue, setEditorValue] = useState("");
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({ text: "Ready", error: false });

  const [activeConversationId, setActiveConversationId] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationHistoryItem[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [commandCatalog, setCommandCatalog] = useState<CommandCatalogResponse | null>(null);
  const [commandCompletions, setCommandCompletions] = useState<CommandCompletionItem[]>([]);
  const [activeRequestId, setActiveRequestId] = useState("");
  const [activeAssistantId, setActiveAssistantId] = useState("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageReport, setUsageReport] = useState<UsageReport | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  const activeRequestIdRef = useRef("");
  const activeAssistantIdRef = useRef("");
  const pendingToolCallsRef = useRef<Map<string, PendingToolCall>>(new Map());
  const highlightedCodeRef = useRef<HighlightedCodeSelection>(createEmptyHighlightedCode());
  const pendingAssistantDeltaRef = useRef("");
  const assistantDeltaFrameRef = useRef<number | null>(null);
  const commandCatalogRef = useRef<CommandCatalogResponse | null>(null);
  const commandCatalogFetchedAtRef = useRef(0);
  const commandCompletionTimerRef = useRef<number | null>(null);
  const currentFileRef = useRef("");
  const pendingFsChangesRef = useRef<Set<string>>(new Set());
  const fsChangeFlushTimerRef = useRef<number | null>(null);
  const fsChangeFlushRunningRef = useRef(false);
  const chatAutoScrollFrameRef = useRef<number | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const conversationHistoryRef = useRef<ConversationHistoryItem[]>([]);
  const preferencesLoadedRef = useRef(false);
  const perfSamplesRef = useRef<Record<string, number[]>>({});

  useEffect(() => {
    directoryCacheRef.current = directoryCache;
  }, [directoryCache]);

  useEffect(() => {
    openDirectoriesRef.current = openDirectories;
  }, [openDirectories]);

  useEffect(() => {
    activeRequestIdRef.current = activeRequestId;
  }, [activeRequestId]);

  useEffect(() => {
    activeAssistantIdRef.current = activeAssistantId;
  }, [activeAssistantId]);

  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  useEffect(() => {
    commandCatalogRef.current = commandCatalog;
  }, [commandCatalog]);

  useEffect(() => {
    conversationHistoryRef.current = conversationHistory;
  }, [conversationHistory]);

  const chatRunning = useMemo(() => Boolean(activeRequestId), [activeRequestId]);
  const hasActiveConversation = useMemo(() => Boolean(activeConversationId), [activeConversationId]);
  const canOpenPreview = hasActiveConversation;
  const effectivePreviewOpen = previewOpen && canOpenPreview;
  const themeLabel = useMemo(() => getThemeLabel(theme), [theme]);
  const logoSrc = useMemo(() => getLogoSrc(theme), [theme]);
  const activeConversationTitle = useMemo(() => {
    const current = conversationHistory.find((entry) => entry.id === activeConversationId);
    if (current?.title && collapseWhitespace(current.title)) {
      return collapseWhitespace(current.title);
    }
    return buildDefaultConversationTitle(Date.now());
  }, [activeConversationId, conversationHistory]);
  const topbarPath = useMemo(() => formatDisplayPath(workspaceRoot, currentFile), [workspaceRoot, currentFile]);
  const sidebarConversations = useMemo(() => {
    if (!activeConversationId) {
      return conversationHistory.map((entry) => ({
        id: entry.id,
        title: entry.title,
        messageCount: entry.messageCount,
        updatedAt: entry.updatedAt,
      }));
    }
    const activeEntryFromHistory = conversationHistory.find((entry) => entry.id === activeConversationId);
    const activeEntry = {
      id: activeConversationId,
      title: activeConversationTitle,
      messageCount: chatMessages.length,
      updatedAt: activeEntryFromHistory?.updatedAt ?? Date.now(),
    };
    const others = conversationHistory
      .filter((entry) => entry.id !== activeConversationId)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        messageCount: entry.messageCount,
        updatedAt: entry.updatedAt,
      }));
    return [activeEntry, ...others];
  }, [activeConversationId, activeConversationTitle, chatMessages.length, conversationHistory]);
  const recentWorkspaces = useMemo<RecentWorkspaceItem[]>(() => {
    const seen = new Set<string>();
    const sorted = [...conversationHistory].sort((a, b) => b.updatedAt - a.updatedAt);
    const recent: RecentWorkspaceItem[] = [];

    for (const entry of sorted) {
      const workspace = String(entry.workspaceRoot || "").trim();
      if (!workspace || seen.has(workspace)) {
        continue;
      }
      seen.add(workspace);
      recent.push({ path: workspace, updatedAt: entry.updatedAt });
      if (recent.length >= 8) {
        break;
      }
    }

    const currentWorkspace = String(workspaceRoot || "").trim();
    if (currentWorkspace && !seen.has(currentWorkspace)) {
      recent.unshift({ path: currentWorkspace, updatedAt: Date.now() });
    }
    return recent.slice(0, 8);
  }, [conversationHistory, workspaceRoot]);

  const setStatus = useCallback((text: string, error = false) => {
    setEditorStatus({ text, error });
  }, []);

  const upsertConversationHistory = useCallback((
    conversationId: string,
    messages: ChatMessage[],
    forcedTitle = "",
    timestampOverride?: number,
  ) => {
    setConversationHistory((prev) => {
      const existing = prev.find((entry) => entry.id === conversationId);
      const remaining = prev.filter((entry) => entry.id !== conversationId);
      if (!hasConversationContent(messages)) {
        return remaining;
      }
      const titleFromExisting = existing?.title ? collapseWhitespace(existing.title) : "";
      const resolvedTitle = forcedTitle.trim() || titleFromExisting || buildDefaultConversationTitle(Date.now());
      const messagesChanged = existing ? !areConversationMessagesEquivalent(existing.messages, messages) : true;
      const updatedAt = timestampOverride
        ?? (messagesChanged ? Date.now() : (existing?.updatedAt ?? Date.now()));
      const updatedEntry: ConversationHistoryItem = {
        id: conversationId,
        title: resolvedTitle,
        updatedAt,
        messageCount: messages.length,
        workspaceRoot: existing?.workspaceRoot ?? (workspaceRoot || null),
        messages: [...messages],
      };
      const next = [updatedEntry, ...remaining];
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      conversationHistoryRef.current = next;
      return next;
    });
  }, [workspaceRoot]);

  const persistConversation = useCallback(async (conversationId: string, messages: ChatMessage[], forcedTitle = "") => {
    if (!conversationId || !hasConversationContent(messages)) {
      return;
    }

    const steps = toHistorySteps(messages);
    if (steps.length === 0) {
      return;
    }

    const existing = conversationHistoryRef.current.find((entry) => entry.id === conversationId);
    const titleFromExisting = existing?.title ? collapseWhitespace(existing.title) : "";
    const resolvedTitle = forcedTitle.trim() || titleFromExisting || buildDefaultConversationTitle(Date.now());
    const previousSteps = existing ? toHistorySteps(existing.messages) : [];
    const stepsChanged = !existing || !areHistoryStepsEquivalent(previousSteps, steps);
    const persistedTimestamp = stepsChanged
      ? Date.now()
      : (existing?.updatedAt ?? Date.now());

    const payload: DesktopConversationHistory = {
      id: conversationId,
      timestamp: persistedTimestamp,
      steps,
      totalSteps: steps.length,
      title: resolvedTitle,
      workspace: workspaceRoot || null,
    };

    try {
      await api.saveConversationHistory(payload);
      upsertConversationHistory(conversationId, messages, resolvedTitle, persistedTimestamp);
    } catch {
    }
  }, [upsertConversationHistory, workspaceRoot]);

  const recordPerfSample = useCallback((metric: string, durationMs: number) => {
    if (!isDevMode) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const bucket = perfSamplesRef.current[metric] ?? [];
    bucket.push(durationMs);
    if (bucket.length > PERF_SAMPLE_LIMIT) {
      bucket.splice(0, bucket.length - PERF_SAMPLE_LIMIT);
    }
    perfSamplesRef.current[metric] = bucket;
  }, [isDevMode]);

  const logPerfSummary = useCallback(() => {
    if (!isDevMode) return;
    const entries = Object.entries(perfSamplesRef.current).filter((entry) => entry[1].length > 0);
    if (entries.length === 0) return;
    const summary = entries
      .map(([metric, values]) => {
        const p50 = computePercentile(values, 0.5);
        const p95 = computePercentile(values, 0.95);
        return `${metric} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms n=${values.length}`;
      })
      .join(" | ");
    console.log(`[renderer perf] ${summary}`);
  }, [isDevMode]);

  useEffect(() => {
    if (!isDevMode) return;
    const intervalId = window.setInterval(() => {
      logPerfSummary();
    }, PERF_LOG_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isDevMode, logPerfSummary]);

  const clearCommandCompletionTimer = useCallback(() => {
    if (commandCompletionTimerRef.current !== null) {
      window.clearTimeout(commandCompletionTimerRef.current);
      commandCompletionTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearCommandCompletionTimer();
    if (!chatInput.trimStart().startsWith("/")) {
      setCommandCompletions([]);
      return clearCommandCompletionTimer;
    }
    commandCompletionTimerRef.current = window.setTimeout(() => {
      commandCompletionTimerRef.current = null;
      setCommandCompletions(computeCommandCompletions(chatInput, commandCatalog));
    }, COMMAND_COMPLETION_DEBOUNCE_MS);
    return clearCommandCompletionTimer;
  }, [chatInput, commandCatalog, clearCommandCompletionTimer]);

  const handleAgentPanelRender: React.ProfilerOnRenderCallback = useCallback(
    (_id, _phase, actualDuration) => {
      recordPerfSample("chat.render", actualDuration);
    },
    [recordPerfSample],
  );

  const refreshCommandCatalog = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && commandCatalogRef.current && now - commandCatalogFetchedAtRef.current < COMMAND_CATALOG_TTL_MS) {
      return commandCatalogRef.current;
    }
    try {
      const catalog = await api.getCommandCatalog();
      commandCatalogFetchedAtRef.current = Date.now();
      commandCatalogRef.current = catalog;
      setCommandCatalog(catalog);
      return catalog;
    } catch {
      commandCatalogFetchedAtRef.current = 0;
      commandCatalogRef.current = null;
      setCommandCatalog(null);
      return null;
    }
  }, []);

  const buildCommandContext = useCallback((messages: ChatMessage[]): DesktopCommandContext => {
    const contextMessages = messages
      .map((message) => {
        if (message.role === "system" || message.role === "error") return null;
        if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
          return {
            role: message.role,
            content: message.content,
            toolName: message.toolName,
            toolArgs: message.toolArgs,
            toolResult: message.toolResult,
            success: message.success,
          };
        }
        return null;
      })
      .filter((message): message is NonNullable<typeof message> => Boolean(message));

    return {
      messages: contextMessages,
      isProcessing: chatRunning,
    };
  }, [chatRunning]);

  useEffect(() => {
    if (!hasConversationContent(chatMessages)) return;
    const timeoutId = window.setTimeout(() => {
      void persistConversation(activeConversationId, chatMessages);
    }, 450);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeConversationId, chatMessages, persistConversation]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (api && typeof api.setWindowTheme === "function") {
      api.setWindowTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!preferencesLoadedRef.current) return;
    void api.setPreferences({
      theme,
      sidebarOpen,
      previewOpen,
    });
  }, [theme, sidebarOpen, previewOpen]);

  useEffect(() => {
    if (canOpenPreview) return;
    if (!previewOpen) return;
    setPreviewOpen(false);
  }, [canOpenPreview, previewOpen]);

  useEffect(() => {
    const applyTopbarHeight = async () => {
      try {
        const constants = await api.getUiConstants();
        const value = typeof constants?.topbarHeight === "number" ? `${constants.topbarHeight}px` : "";
        if (value) {
          document.documentElement.style.setProperty("--topbar-height", value);
        }
        if (typeof constants?.isDev === "boolean") {
          setIsDevMode(constants.isDev);
        }
      } catch {
      }
    };
    void applyTopbarHeight();
  }, []);

  const ensureDirLoaded = useCallback(async (relativePath: string) => {
    const normalized = normalizeRelative(relativePath);
    if (directoryCacheRef.current[normalized]) return;
    const entries = await api.readDir(normalized);
    const nextEntries = Array.isArray(entries) ? entries : [];
    setDirectoryCache((prev) => {
      if (areFsEntriesEquivalent(prev[normalized], nextEntries)) return prev;
      return { ...prev, [normalized]: nextEntries };
    });
  }, []);

  const refreshTree = useCallback(async (resetOpenDirectories = false) => {
    const rootEntries = await api.readDir("");
    const nextRootEntries = Array.isArray(rootEntries) ? rootEntries : [];
    setDirectoryCache((prev) => {
      if (areFsEntriesEquivalent(prev[""], nextRootEntries)) return prev;
      return { ...prev, "": nextRootEntries };
    });
    if (resetOpenDirectories) {
      setOpenDirectories((prev) => {
        if (prev.size === 1 && prev.has("")) return prev;
        return new Set([""]);
      });
    }
  }, []);

  const refreshDirectories = useCallback(async (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.map((entry) => normalizeRelative(entry))));
    if (uniquePaths.length === 0) return;
    const entriesByPath = await Promise.all(
      uniquePaths.map(async (relativePath) => {
        try {
          const entries = await api.readDir(relativePath);
          return { relativePath, entries: Array.isArray(entries) ? entries : [] as FsEntry[] };
        } catch {
          return { relativePath, entries: [] as FsEntry[] };
        }
      }),
    );

    setDirectoryCache((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of entriesByPath) {
        const normalizedEntries = Array.isArray(entry.entries) ? entry.entries : [];
        if (areFsEntriesEquivalent(prev[entry.relativePath], normalizedEntries)) {
          continue;
        }
        next[entry.relativePath] = normalizedEntries;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const refreshDirectoriesForChanges = useCallback(async (changes: string[], fullRefresh: boolean) => {
    if (fullRefresh) {
      const targets = new Set<string>([""]);
      for (const openPath of openDirectoriesRef.current.values()) {
        targets.add(normalizeRelative(openPath));
      }
      await refreshDirectories(Array.from(targets.values()));
      return;
    }

    const loadedPaths = new Set(Object.keys(directoryCacheRef.current));
    if (loadedPaths.size === 0) {
      await refreshTree();
      return;
    }

    const targets = new Set<string>([""]);
    for (const change of changes) {
      const normalized = normalizeRelative(change);
      if (!normalized) {
        targets.add("");
        continue;
      }
      const parent = getParentPath(normalized);
      if (loadedPaths.has(parent)) {
        targets.add(parent);
      }
      if (loadedPaths.has(normalized)) {
        targets.add(normalized);
      }
      if (!parent) {
        targets.add("");
      }
    }
    await refreshDirectories(Array.from(targets.values()));
  }, [refreshDirectories, refreshTree]);

  const openFile = useCallback(async (relativePath: string) => {
    const normalized = normalizeRelative(relativePath);
    if (!normalized) return;
    const startedAt = performance.now();
    setCurrentFile(normalized);
    setPreviewOpen(true);
    if (getMediaKind(normalized)) {
      setEditorValue("");
      setStatus("File loaded");
      window.requestAnimationFrame(() => {
        recordPerfSample("file.open", performance.now() - startedAt);
      });
      return;
    }
    setEditorValue("");
    try {
      const file = await api.readFile(normalized);
      setCurrentFile(normalizeRelative(file.relativePath));
      setEditorValue(file.content);
      if (file.truncated) {
        const previewBytes = typeof file.previewBytes === "number" ? file.previewBytes : file.content.length;
        const totalBytes = typeof file.totalBytes === "number" ? file.totalBytes : previewBytes;
        setStatus(`File loaded (preview ${formatBytes(previewBytes)} of ${formatBytes(totalBytes)})`);
      } else {
        setStatus("File loaded");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot open file";
      setStatus(message, true);
    } finally {
      window.requestAnimationFrame(() => {
        recordPerfSample("file.open", performance.now() - startedAt);
      });
    }
  }, [recordPerfSample, setStatus]);

  const closeCurrentFile = useCallback(() => {
    setCurrentFile("");
    setEditorValue("");
    highlightedCodeRef.current = createEmptyHighlightedCode();
    setStatus("Ready");
  }, [setStatus]);

  const handleHighlightedCodeChange = useCallback((selection: HighlightedCodeSelection) => {
    highlightedCodeRef.current = selection;
  }, []);

  const toggleDirectory = useCallback(async (relativePath: string) => {
    const normalized = normalizeRelative(relativePath);
    const startedAt = performance.now();
    const isOpen = openDirectoriesRef.current.has(normalized);
    if (isOpen) {
      setOpenDirectories((prev) => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
      window.requestAnimationFrame(() => {
        recordPerfSample("explorer.toggle", performance.now() - startedAt);
      });
      return;
    }
    setOpenDirectories((prev) => {
      const next = new Set(prev);
      next.add(normalized);
      return next;
    });
    await ensureDirLoaded(normalized);
    window.requestAnimationFrame(() => {
      recordPerfSample("explorer.toggle", performance.now() - startedAt);
    });
  }, [ensureDirLoaded, recordPerfSample]);

  const flushAssistantDelta = useCallback(() => {
    const chunk = pendingAssistantDeltaRef.current;
    if (!chunk) return;
    pendingAssistantDeltaRef.current = "";

    let assistantId = activeAssistantIdRef.current;
    if (!assistantId) {
      assistantId = createId("assistant");
      activeAssistantIdRef.current = assistantId;
      setActiveAssistantId(assistantId);
    }

    setChatMessages((prev) => {
      const index = prev.findIndex((message) => message.id === assistantId);
      if (index < 0) {
        return [...prev, { id: assistantId, role: "assistant", content: chunk }];
      }
      const next = [...prev];
      next[index] = { ...next[index]!, content: `${next[index]!.content}${chunk}` };
      return next;
    });
  }, []);

  const scheduleAssistantDeltaFlush = useCallback(() => {
    if (assistantDeltaFrameRef.current !== null) return;
    assistantDeltaFrameRef.current = window.requestAnimationFrame(() => {
      assistantDeltaFrameRef.current = null;
      flushAssistantDelta();
    });
  }, [flushAssistantDelta]);

  const resetAssistantDeltaBuffer = useCallback(() => {
    pendingAssistantDeltaRef.current = "";
    if (assistantDeltaFrameRef.current !== null) {
      window.cancelAnimationFrame(assistantDeltaFrameRef.current);
      assistantDeltaFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    resetAssistantDeltaBuffer();
  }, [resetAssistantDeltaBuffer]);

  const clearFsFlushTimer = useCallback(() => {
    if (fsChangeFlushTimerRef.current !== null) {
      window.clearTimeout(fsChangeFlushTimerRef.current);
      fsChangeFlushTimerRef.current = null;
    }
  }, []);

  const flushQueuedFsChanges = useCallback(async () => {
    if (fsChangeFlushRunningRef.current) return;
    fsChangeFlushRunningRef.current = true;
    clearFsFlushTimer();

    try {
      while (pendingFsChangesRef.current.size > 0) {
        const queuedChanges = Array.from(pendingFsChangesRef.current.values());
        pendingFsChangesRef.current.clear();

        const fullRefresh = queuedChanges.includes(FS_CHANGE_FULL_REFRESH_TOKEN);
        const changes = fullRefresh
          ? []
          : queuedChanges
              .map((entry) => normalizeRelative(entry))
              .filter(Boolean);
        const catalogTouched = changes.some((entry) => entry.toLowerCase().startsWith(".mosaic/skills/"));

        await refreshDirectoriesForChanges(changes, fullRefresh);
        if (catalogTouched) {
          await refreshCommandCatalog(true);
        }

        const activeFile = currentFileRef.current;
        if (!activeFile) {
          setStatus("Workspace refreshed");
          continue;
        }

        const activeFileParent = getParentPath(activeFile);
        const activeFileBaseName = getBaseName(activeFile);
        const shouldReloadCurrent = fullRefresh || changes.some((entry) => {
          const normalized = normalizeRelative(entry);
          if (!normalized) return false;
          if (normalized === activeFile) return true;
          if (normalized === activeFileParent) return true;
          if (!normalized.includes("/") && normalized === activeFileBaseName) return true;
          return false;
        });

        if (shouldReloadCurrent) {
          await openFile(activeFile);
          setStatus("File updated from disk");
        }
      }
    } finally {
      fsChangeFlushRunningRef.current = false;
      if (pendingFsChangesRef.current.size > 0 && fsChangeFlushTimerRef.current === null) {
        fsChangeFlushTimerRef.current = window.setTimeout(() => {
          fsChangeFlushTimerRef.current = null;
          void flushQueuedFsChanges();
        }, FS_CHANGE_DEBOUNCE_MS);
      }
    }
  }, [clearFsFlushTimer, openFile, refreshCommandCatalog, refreshDirectoriesForChanges, setStatus]);

  const scheduleFsFlush = useCallback(() => {
    clearFsFlushTimer();
    fsChangeFlushTimerRef.current = window.setTimeout(() => {
      fsChangeFlushTimerRef.current = null;
      void flushQueuedFsChanges();
    }, FS_CHANGE_DEBOUNCE_MS);
  }, [clearFsFlushTimer, flushQueuedFsChanges]);

  const INTERRUPTED_MESSAGE = "Conversation interrupted — tell Mosaic what to do differently. Something went wrong? Hit `/feedback` to report the issue.";

  const finalizeChatRun = useCallback((statusText: string) => {
    flushAssistantDelta();
    const assistantId = activeAssistantIdRef.current;
    setChatMessages((prev) => {
      const next = [...prev];
      if (assistantId) {
        const assistantIndex = next.findIndex((message) => message.id === assistantId);
        if (assistantIndex >= 0 && !next[assistantIndex]!.content.trim()) {
          next[assistantIndex] = { ...next[assistantIndex]!, content: "No textual response." };
        }
      }
      if (statusText) {
        const isError = statusText === INTERRUPTED_MESSAGE;
        next.push({
          id: createId(isError ? "error" : "system"),
          role: isError ? "error" : "system",
          content: statusText,
          isError,
        });
      }
      return next;
    });
    resetAssistantDeltaBuffer();
    pendingToolCallsRef.current.clear();
    activeRequestIdRef.current = "";
    setActiveRequestId("");
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");
  }, [flushAssistantDelta, resetAssistantDeltaBuffer]);

  const appendChatMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prev) => [...prev, message]);
  }, []);

  const updateChatMessage = useCallback((messageId: string, patch: Partial<ChatMessage>) => {
    setChatMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId);
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...next[index]!, ...patch };
      return next;
    });
  }, []);

  const executeLocalCommand = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (activeRequestIdRef.current) return;
    const isUsageCommand = /^\/usage(?:\s|$)/i.test(trimmed);
    if (isUsageCommand) {
      setUsageLoading(true);
      setUsageError("");
    }

    const context = buildCommandContext(chatMessages);
    const baseMessages = chatMessages;

    try {
      const result = await api.executeCommand(trimmed, context);

      if (result.openUsageView) {
        if (result.usageReport) {
          setUsageReport(result.usageReport);
          setUsageError("");
          setUsageOpen(true);
          setUsageLoading(false);
        } else {
          setUsageError("Usage report is unavailable.");
        }
      }

      if (result.errorBanner) {
        appendChatMessage({
          id: createId("error"),
          role: "error",
          content: result.errorBanner,
          isError: true,
        });
      }

      if (result.shouldClearMessages) {
        void persistConversation(activeConversationId, baseMessages);
        setActiveConversationId("");
        pendingToolCallsRef.current.clear();
        activeAssistantIdRef.current = "";
        setActiveAssistantId("");
        setUsageOpen(false);
      }

      const historyBase = result.shouldClearMessages ? [] : baseMessages;

      if (result.shouldAddToHistory) {
        const userMessage: ChatMessage = {
          id: createId("user"),
          role: "user",
          content: result.content,
          displayContent: trimmed,
        };

        setChatMessages([...historyBase, userMessage]);
        activeAssistantIdRef.current = "";
        setActiveAssistantId("");

        const history = buildAgentHistory(historyBase);
        const response = await api.startChat([...history, { role: "user", content: result.content }]);
        setActiveRequestId(response.requestId);
      } else {
        const nextMessages = result.shouldClearMessages ? [] : [...baseMessages];
        const shouldAppendMessage = Boolean(result.content && result.content.trim()) && !result.openUsageView;
        if (shouldAppendMessage) {
          const isError = !result.success;
          nextMessages.push({
            id: createId(isError ? "error" : "system"),
            role: isError ? "error" : "system",
            content: result.content,
            isError,
          });
        }
        if (result.shouldClearMessages || shouldAppendMessage) {
          setChatMessages(nextMessages);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to execute command";
      appendChatMessage({
        id: createId("error"),
        role: "error",
        content: formatDesktopError(message, { source: "runtime" }),
        isError: true,
      });
      finalizeChatRun("");
    } finally {
      setUsageLoading(false);
      void refreshCommandCatalog();
    }
  }, [activeConversationId, appendChatMessage, buildCommandContext, chatMessages, finalizeChatRun, persistConversation, refreshCommandCatalog]);

  const refreshUsage = useCallback(async () => {
    if (activeRequestIdRef.current) return;
    setUsageLoading(true);
    setUsageError("");
    try {
      const result = await api.executeCommand("/usage --refresh", buildCommandContext(chatMessages));
      if (result.usageReport) {
        setUsageReport(result.usageReport);
        setUsageOpen(true);
        return;
      }
      throw new Error(result.content || "Unable to load usage report.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load usage report.";
      setUsageError(message);
    } finally {
      setUsageLoading(false);
    }
  }, [buildCommandContext, chatMessages]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    if (event.type === "text-delta") {
      const chunk = event.content ?? "";
      if (!chunk) return;
      pendingAssistantDeltaRef.current += chunk;
      scheduleAssistantDeltaFlush();
      return;
    }

    flushAssistantDelta();

    if (event.type === "tool-call-end") {
      const toolName = typeof event.toolName === "string" && event.toolName ? event.toolName : "tool";
      const toolArgs = event.args ?? {};
      const callId = event.toolCallId ?? createId("tool-call");
      let toolId: string | undefined;

      if (shouldShowRunningTool(toolName)) {
        toolId = createId("tool");
        const argsLabel = summarizeArgs(toolArgs);
        const content = argsLabel ? `${toolName} ${argsLabel}` : toolName;
        appendChatMessage({
          id: toolId,
          role: "tool",
          content,
          running: true,
          toolName,
          toolArgs,
          toolResult: null,
          success: true,
        });
      }

      pendingToolCallsRef.current.set(callId, { toolId, toolName, toolArgs });
      return;
    }

    if (event.type === "tool-result") {
      const callId = event.toolCallId ?? "";
      const pending = pendingToolCallsRef.current.get(callId);
      if (pending) {
        pendingToolCallsRef.current.delete(callId);
      }
      const toolId = pending?.toolId;
      const toolName = pending?.toolName ?? event.toolName ?? "tool";
      const toolArgs = pending?.toolArgs ?? {};
      const renderedResult = stringifyValue(event.result);
      const failed = /error|failed/i.test(renderedResult);
      if (!toolId) {
        appendChatMessage({
          id: createId("tool"),
          role: "tool",
          content: renderedResult,
          running: false,
          toolName,
          toolArgs,
          toolResult: event.result,
          success: !failed,
        });
        activeAssistantIdRef.current = "";
        setActiveAssistantId("");
        return;
      }
      updateChatMessage(toolId, {
        content: renderedResult,
        running: false,
        toolName,
        toolArgs,
        toolResult: event.result,
        success: !failed,
      });
      activeAssistantIdRef.current = "";
      setActiveAssistantId("");
      return;
    }

    if (event.type === "error") {
      appendChatMessage({
        id: createId("error"),
        role: "error",
        content: formatDesktopError(event.error ?? "Agent error", {
          source: event.source ?? "provider",
          provider: event.provider,
          model: event.model,
        }),
        isError: true,
      });
    }
  }, [appendChatMessage, flushAssistantDelta, scheduleAssistantDeltaFlush, updateChatMessage]);

  const sendChat = useCallback(async () => {
    if (activeRequestIdRef.current) return;
    const prompt = chatInput.trim();
    if (!prompt) return;

    setChatInput("");
    if (prompt.startsWith("/")) {
      await executeLocalCommand(prompt);
      return;
    }

    const promptWithHighlightedCode = buildPromptWithHighlightedCode(
      prompt,
      currentFile,
      editorValue,
      highlightedCodeRef.current,
    );
    const history = buildAgentHistory(chatMessages);
    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: promptWithHighlightedCode,
      displayContent: prompt,
    };

    setChatMessages((prev) => [...prev, userMessage]);
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");

    try {
      const response = await api.startChat([...history, { role: "user", content: promptWithHighlightedCode }]);
      setActiveRequestId(response.requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start chat";
      appendChatMessage({
        id: createId("error"),
        role: "error",
        content: formatDesktopError(message, { source: "runtime" }),
        isError: true,
      });
      finalizeChatRun("");
    }
  }, [appendChatMessage, chatInput, chatMessages, currentFile, editorValue, executeLocalCommand, finalizeChatRun]);

  const stopChat = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    finalizeChatRun(INTERRUPTED_MESSAGE);
    void api.cancelChat(requestId).catch(() => {});
  }, [finalizeChatRun]);

  const openConversation = useCallback((conversationId: string) => {
    if (activeRequestIdRef.current) return;
    if (!conversationId || conversationId === activeConversationId) return;
    const target = conversationHistoryRef.current.find((entry) => entry.id === conversationId);
    if (!target) return;

    void (async () => {
      void persistConversation(activeConversationId, chatMessages);
      const targetWorkspace = typeof target.workspaceRoot === "string" ? target.workspaceRoot.trim() : "";
      if (targetWorkspace && targetWorkspace !== workspaceRoot) {
        try {
          await api.setWorkspace(targetWorkspace);
        } catch {
        }
      }

      resetAssistantDeltaBuffer();
      pendingToolCallsRef.current.clear();
      setChatInput("");
      setUsageOpen(false);
      setUsageReport(null);
      setUsageLoading(false);
      setUsageError("");
      activeAssistantIdRef.current = "";
      setActiveAssistantId("");
      setActiveConversationId(conversationId);
      setChatMessages(target.messages);
    })();
  }, [activeConversationId, chatMessages, persistConversation, resetAssistantDeltaBuffer, workspaceRoot]);

  const startNewConversation = useCallback(() => {
    if (activeRequestIdRef.current) return;
    void persistConversation(activeConversationId, chatMessages);
    const nextConversationId = createId("conversation");
    resetAssistantDeltaBuffer();
    pendingToolCallsRef.current.clear();
    setChatMessages([]);
    setChatInput("");
    setUsageOpen(false);
    setUsageReport(null);
    setUsageLoading(false);
    setUsageError("");
    setActiveConversationId(nextConversationId);
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");
  }, [activeConversationId, chatMessages, persistConversation, resetAssistantDeltaBuffer]);
  const startNewConversationInWorkspace = useCallback((targetWorkspace: string) => {
    if (activeRequestIdRef.current) return;
    const nextWorkspace = String(targetWorkspace || "").trim();
    if (!nextWorkspace) {
      startNewConversation();
      return;
    }

    void (async () => {
      void persistConversation(activeConversationId, chatMessages);
      if (nextWorkspace !== workspaceRoot) {
        try {
          await api.setWorkspace(nextWorkspace);
        } catch {
        }
      }

      const nextConversationId = createId("conversation");
      resetAssistantDeltaBuffer();
      pendingToolCallsRef.current.clear();
      setChatMessages([]);
      setChatInput("");
      setUsageOpen(false);
      setUsageReport(null);
      setUsageLoading(false);
      setUsageError("");
      setActiveConversationId(nextConversationId);
      activeAssistantIdRef.current = "";
      setActiveAssistantId("");
    })();
  }, [activeConversationId, chatMessages, persistConversation, resetAssistantDeltaBuffer, startNewConversation, workspaceRoot]);

  const renameConversation = useCallback(async (conversationId: string, nextTitle: string) => {
    if (activeRequestIdRef.current) return;
    const safeId = String(conversationId || "").trim();
    const safeTitle = collapseWhitespace(nextTitle);
    if (!safeId || !safeTitle) return;

    const current = conversationHistoryRef.current;
    let found = false;
    const updated = current.map((entry) => {
      if (entry.id !== safeId) return entry;
      found = true;
      return { ...entry, title: safeTitle };
    });

    const nextHistory = found
      ? updated
      : (
        safeId === activeConversationId
          ? [{
            id: safeId,
            title: safeTitle,
            updatedAt: Date.now(),
            messageCount: chatMessages.length,
            workspaceRoot: workspaceRoot || null,
            messages: [...chatMessages],
          }, ...updated]
          : updated
      );
    nextHistory.sort((a, b) => b.updatedAt - a.updatedAt);
    conversationHistoryRef.current = nextHistory;
    setConversationHistory(nextHistory);

    try {
      await api.renameConversationHistory(safeId, safeTitle);
      if (safeId === activeConversationId) {
        await persistConversation(safeId, chatMessages, safeTitle);
      }
    } catch {
    }
  }, [activeConversationId, chatMessages, persistConversation]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    if (activeRequestIdRef.current) return;
    const safeId = String(conversationId || "").trim();
    if (!safeId) return;

    const filtered = conversationHistoryRef.current
      .filter((entry) => entry.id !== safeId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    conversationHistoryRef.current = filtered;
    setConversationHistory(filtered);

    const wasActive = safeId === activeConversationId;
    if (wasActive) {
      const nextConversation = filtered[0];
      resetAssistantDeltaBuffer();
      pendingToolCallsRef.current.clear();
      setChatInput("");
      setUsageOpen(false);
      setUsageReport(null);
      setUsageLoading(false);
      setUsageError("");
      activeAssistantIdRef.current = "";
      setActiveAssistantId("");

      if (nextConversation) {
        setActiveConversationId(nextConversation.id);
        setChatMessages(nextConversation.messages);
      } else {
        setActiveConversationId("");
        setChatMessages([]);
      }
    }

    try {
      await api.deleteConversationHistory(safeId);
    } catch {
    }
  }, [activeConversationId, resetAssistantDeltaBuffer]);

  const applyCompletion = useCallback((completion: CommandCompletionItem) => {
    setChatInput((prev) => applyCommandCompletion(prev, completion.token));
  }, []);

  const pickWorkspace = useCallback(async () => {
    const result = await api.pickWorkspace();
    if (!result.changed) return;
    setWorkspaceRoot(result.workspaceRoot ?? "");
    setCurrentFile("");
    setEditorValue("");
    highlightedCodeRef.current = createEmptyHighlightedCode();
    await refreshTree(true);
    setStatus("Workspace changed");
  }, [refreshTree, setStatus]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const preferences = await api.getPreferences();
        if (preferences.theme === "dark" || preferences.theme === "light") {
          setTheme(preferences.theme);
        }
        if (typeof preferences.sidebarOpen === "boolean") {
          setSidebarOpen(preferences.sidebarOpen);
        }
        if (typeof preferences.previewOpen === "boolean") {
          setPreviewOpen(preferences.previewOpen);
        }
        if (typeof preferences.workspaceRoot === "string") {
          setWorkspaceRoot(preferences.workspaceRoot);
        }
      } catch {
      } finally {
        preferencesLoadedRef.current = true;
      }

      try {
        const initialWorkspace = await api.getWorkspace();
        const historyPayload = await api.getConversationHistory();
        const loadedConversations = Array.isArray(historyPayload?.conversations)
          ? historyPayload.conversations.map(toConversationHistoryItem)
          : [];
        setConversationHistory(loadedConversations);
        const lastConversationId = typeof historyPayload?.lastConversationId === "string"
          ? historyPayload.lastConversationId
          : null;
        const selectedConversation = (
          loadedConversations.find((entry) => entry.id === lastConversationId)
          ?? loadedConversations[0]
        );
        let resolvedWorkspace = initialWorkspace.workspaceRoot ?? "";
        const selectedWorkspace = typeof selectedConversation?.workspaceRoot === "string"
          ? selectedConversation.workspaceRoot.trim()
          : "";
        if (selectedWorkspace && selectedWorkspace !== resolvedWorkspace) {
          try {
            const switched = await api.setWorkspace(selectedWorkspace);
            resolvedWorkspace = switched.workspaceRoot ?? selectedWorkspace;
          } catch {
            resolvedWorkspace = initialWorkspace.workspaceRoot ?? "";
          }
        }

        setWorkspaceRoot(resolvedWorkspace);
        await refreshTree(true);
        await refreshCommandCatalog(true);
        if (selectedConversation) {
          setActiveConversationId(selectedConversation.id);
          setChatMessages(selectedConversation.messages);
        } else {
          setActiveConversationId("");
          setChatMessages([]);
        }
        setStatus("Ready");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Initialization failed";
        setStatus(message, true);
      }
    };
    void init();
  }, [refreshCommandCatalog, refreshTree, setStatus]);

  useEffect(() => {
    const unsubscribe = api.onChatEvent((payload) => {
      if (!payload || payload.requestId !== activeRequestIdRef.current) return;

      if (payload.type === "event" && payload.event) {
        handleAgentEvent(payload.event);
        return;
      }

      if (payload.type === "error") {
        flushAssistantDelta();
        appendChatMessage({
          id: createId("error"),
          role: "error",
          content: formatDesktopError(payload.error ?? "Runtime error", {
            source: payload.source ?? "backend",
            provider: payload.provider,
            model: payload.model,
          }),
          isError: true,
        });
        return;
      }

      if (payload.type === "done") {
        flushAssistantDelta();
      }
    });
    return unsubscribe;
  }, [appendChatMessage, finalizeChatRun, flushAssistantDelta, handleAgentEvent]);

  useEffect(() => {
    const unsubscribe = api.onWorkspaceChanged(async (payload) => {
      setWorkspaceRoot(payload.workspaceRoot ?? "");
      setCurrentFile("");
      setEditorValue("");
      highlightedCodeRef.current = createEmptyHighlightedCode();
      await refreshTree(true);
      await refreshCommandCatalog(true);
      setStatus("Workspace changed");
    });
    return unsubscribe;
  }, [refreshCommandCatalog, refreshTree, setStatus]);

  useEffect(() => {
    if (currentFile) return;
    highlightedCodeRef.current = createEmptyHighlightedCode();
  }, [currentFile]);

  useEffect(() => {
    const unsubscribe = api.onFsChanged(async (payload) => {
      const changes = Array.isArray(payload?.changes) ? payload.changes : [];
      if (changes.length === 0) {
        pendingFsChangesRef.current.add(FS_CHANGE_FULL_REFRESH_TOKEN);
      } else {
        for (const entry of changes) {
          const normalized = normalizeRelative(entry);
          if (normalized) {
            pendingFsChangesRef.current.add(normalized);
          }
        }
      }
      scheduleFsFlush();
    });
    return () => {
      unsubscribe();
      clearFsFlushTimer();
      pendingFsChangesRef.current.clear();
    };
  }, [clearFsFlushTimer, scheduleFsFlush]);

  useEffect(() => {
    const unsubscribe = api.onFsWatchError((payload) => {
      const message = payload?.error ? `File watcher error: ${payload.error}` : "File watcher error";
      setStatus(message, true);
    });
    return unsubscribe;
  }, [setStatus]);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog) return;
    const distanceFromBottom = chatLog.scrollHeight - (chatLog.scrollTop + chatLog.clientHeight);
    if (distanceFromBottom > CHAT_AUTO_SCROLL_NEAR_BOTTOM_PX) return;

    if (chatAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatAutoScrollFrameRef.current);
    }
    chatAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatAutoScrollFrameRef.current = null;
      const target = chatLogRef.current;
      if (!target) return;
      target.scrollTop = target.scrollHeight;
    });
  }, [chatMessages]);

  useEffect(() => () => {
    if (chatAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatAutoScrollFrameRef.current);
      chatAutoScrollFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearFsFlushTimer();
    pendingFsChangesRef.current.clear();
  }, [clearFsFlushTimer]);

  useEffect(() => () => {
    clearCommandCompletionTimer();
  }, [clearCommandCompletionTimer]);

  const handleToggleDirectory = useCallback((path: string) => {
    void toggleDirectory(path);
  }, [toggleDirectory]);

  const handleOpenFile = useCallback((path: string) => {
    void openFile(path);
  }, [openFile]);

  return (
    <div className="shell">
      <TopBar
        platform={platform}
        logoSrc={logoSrc}
        workspaceRoot={workspaceRoot}
        formattedPath={topbarPath}
        showTitle={hasActiveConversation || usageOpen}
        sidebarOpen={sidebarOpen}
        previewOpen={effectivePreviewOpen}
        previewEnabled={canOpenPreview}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        onTogglePreview={() => {
          if (!canOpenPreview) return;
          setPreviewOpen((prev) => !prev);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className={`workspace-layout ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <Sidebar
          workspaceRoot={workspaceRoot}
          currentFile={currentFile}
          themeLabel={themeLabel}
          conversations={sidebarConversations}
          activeConversationId={activeConversationId}
          isRunning={chatRunning}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleTheme={toggleTheme}
          onNewThread={startNewConversation}
          onSelectConversation={openConversation}
          onRenameConversation={renameConversation}
          onDeleteConversation={deleteConversation}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />
        <main className={`content-layout ${effectivePreviewOpen ? "preview-open" : "preview-closed"}`}>
          {effectivePreviewOpen && (
            <EditorPanel
              currentFile={currentFile}
              editorValue={editorValue}
              logoSrc={logoSrc}
              workspaceRoot={workspaceRoot}
              directoryCache={directoryCache}
              openDirectories={openDirectories}
              onToggleDirectory={handleToggleDirectory}
              onOpenFile={handleOpenFile}
              onCloseFile={closeCurrentFile}
              onHighlightedCodeChange={handleHighlightedCodeChange}
            />
          )}
          <Profiler id="AgentPanel" onRender={handleAgentPanelRender}>
            {usageOpen ? (
              <UsagePanel
                report={usageReport}
                loading={usageLoading}
                error={usageError}
                onRefresh={() => {
                  void refreshUsage();
                }}
                onClose={() => setUsageOpen(false)}
              />
            ) : (
              <AgentPanel
                hasActiveConversation={hasActiveConversation}
                messages={chatMessages}
                workspaceRoot={workspaceRoot}
                recentWorkspaces={recentWorkspaces}
                inputValue={chatInput}
                isRunning={chatRunning}
                chatLogRef={chatLogRef}
                commandCompletions={commandCompletions}
                onInputChange={setChatInput}
                onApplyCompletion={applyCompletion}
                onSend={() => {
                  void sendChat();
                }}
                onStop={() => {
                  void stopChat();
                }}
                onClear={startNewConversation}
                onStartInWorkspace={startNewConversationInWorkspace}
              />
            )}
          </Profiler>
        </main>
      </div>
      <SettingsModal
        open={settingsOpen}
        workspaceRoot={workspaceRoot}
        themeLabel={themeLabel}
        currentFile={currentFile}
        onClose={() => setSettingsOpen(false)}
        onPickWorkspace={() => {
          void pickWorkspace();
        }}
        onToggleTheme={toggleTheme}
        onRefresh={() => {
          void refreshTree();
        }}
      />
    </div>
  );
}
