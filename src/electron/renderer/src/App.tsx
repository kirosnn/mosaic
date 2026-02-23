import React, { Profiler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { EditorPanel, type HighlightedCodeSelection } from "./components/EditorPanel";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { getLogoSrc, getThemeLabel } from "./constants";
import { getMediaKind } from "./mediaPreview";
import { applyCommandCompletion, computeCommandCompletions, type CommandCompletionItem } from "./commandCompletion";
import type {
  AgentEvent,
  ChatMessage,
  CommandCatalogResponse,
  DesktopCommandContext,
  EditorStatus,
  FsEntry,
  Theme,
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

  const [currentFile, setCurrentFile] = useState("");
  const [editorValue, setEditorValue] = useState("");
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({ text: "Ready", error: false });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [commandCatalog, setCommandCatalog] = useState<CommandCatalogResponse | null>(null);
  const [commandCompletions, setCommandCompletions] = useState<CommandCompletionItem[]>([]);
  const [activeRequestId, setActiveRequestId] = useState("");
  const [activeAssistantId, setActiveAssistantId] = useState("");
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
  const preferencesLoadedRef = useRef(false);
  const perfSamplesRef = useRef<Record<string, number[]>>({});

  useEffect(() => {
    directoryCacheRef.current = directoryCache;
  }, [directoryCache]);

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

  const chatRunning = useMemo(() => Boolean(activeRequestId), [activeRequestId]);
  const themeLabel = useMemo(() => getThemeLabel(theme), [theme]);
  const logoSrc = useMemo(() => getLogoSrc(theme), [theme]);

  const setStatus = useCallback((text: string, error = false) => {
    setEditorStatus({ text, error });
  }, []);

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
        if (message.role === "system") return null;
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
    setDirectoryCache((prev) => ({ ...prev, [normalized]: Array.isArray(entries) ? entries : [] }));
  }, []);

  const refreshTree = useCallback(async (resetOpenDirectories = false) => {
    const rootEntries = await api.readDir("");
    setDirectoryCache((prev) => ({ ...prev, "": rootEntries }));
    if (resetOpenDirectories) {
      setOpenDirectories(new Set([""]));
    }
  }, []);

  const refreshLoadedDirectories = useCallback(async () => {
    const loadedPaths = Object.keys(directoryCacheRef.current);
    if (loadedPaths.length === 0) {
      await refreshTree();
      return;
    }

    const entriesByPath = await Promise.all(
      loadedPaths.map(async (relativePath) => {
        try {
          const entries = await api.readDir(relativePath);
          return { relativePath, entries: Array.isArray(entries) ? entries : [] as FsEntry[] };
        } catch {
          return { relativePath, entries: [] as FsEntry[] };
        }
      })
    );

    setDirectoryCache((prev) => {
      const next = { ...prev };
      for (const entry of entriesByPath) {
        next[entry.relativePath] = entry.entries;
      }
      return next;
    });
  }, [refreshTree]);

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
    const isOpen = openDirectories.has(normalized);
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
  }, [ensureDirLoaded, openDirectories, recordPerfSample]);

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

        await refreshLoadedDirectories();
        if (catalogTouched) {
          await refreshCommandCatalog(true);
        }

        const activeFile = currentFileRef.current;
        if (!activeFile) {
          setStatus("Workspace refreshed");
          continue;
        }

        const shouldReloadCurrent = fullRefresh || changes.some((entry) => {
          return entry === activeFile || entry.startsWith(`${activeFile}/`) || activeFile.startsWith(`${entry}/`);
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
  }, [clearFsFlushTimer, openFile, refreshCommandCatalog, refreshLoadedDirectories, setStatus]);

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
          id: createId("system"),
          role: "system",
          content: statusText,
          isError,
        });
      }
      return next;
    });
    resetAssistantDeltaBuffer();
    pendingToolCallsRef.current.clear();
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

    const context = buildCommandContext(chatMessages);
    const baseMessages = chatMessages;

    try {
      const result = await api.executeCommand(trimmed, context);

      if (result.errorBanner) {
        appendChatMessage({
          id: createId("system"),
          role: "system",
          content: result.errorBanner,
          isError: true,
        });
      }

      if (result.shouldClearMessages) {
        pendingToolCallsRef.current.clear();
        activeAssistantIdRef.current = "";
        setActiveAssistantId("");
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
        if (result.content && result.content.trim()) {
          nextMessages.push({
            id: createId("system"),
            role: "system",
            content: result.content,
            isError: !result.success,
          });
        }
        setChatMessages(nextMessages);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to execute command";
      appendChatMessage({
        id: createId("system"),
        role: "system",
        content: formatDesktopError(message, { source: "runtime" }),
        isError: true,
      });
      finalizeChatRun("");
    } finally {
      void refreshCommandCatalog();
    }
  }, [appendChatMessage, buildCommandContext, chatMessages, finalizeChatRun, refreshCommandCatalog]);

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
        id: createId("system"),
        role: "system",
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
        id: createId("system"),
        role: "system",
        content: formatDesktopError(message, { source: "runtime" }),
        isError: true,
      });
      finalizeChatRun("");
    }
  }, [appendChatMessage, chatInput, chatMessages, currentFile, editorValue, executeLocalCommand, finalizeChatRun]);

  const stopChat = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    try {
      await api.cancelChat(requestId);
    } finally {
      finalizeChatRun("Conversation interrupted — tell Mosaic what to do differently. Something went wrong? Hit `/feedback` to report the issue.");
    }
  }, [finalizeChatRun]);

  const clearChat = useCallback(() => {
    if (activeRequestIdRef.current) return;
    resetAssistantDeltaBuffer();
    pendingToolCallsRef.current.clear();
    setChatMessages([]);
    setChatInput("");
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");
  }, [resetAssistantDeltaBuffer]);

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
        const workspace = await api.getWorkspace();
        setWorkspaceRoot(workspace.workspaceRoot ?? "");
        await refreshTree(true);
        await refreshCommandCatalog(true);
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
          id: createId("system"),
          role: "system",
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
        sidebarOpen={sidebarOpen}
        previewOpen={previewOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        onTogglePreview={() => setPreviewOpen((prev) => !prev)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className={`workspace-layout ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <Sidebar
          workspaceRoot={workspaceRoot}
          currentFile={currentFile}
          themeLabel={themeLabel}
          chatCount={chatMessages.length}
          isRunning={chatRunning}
          onOpenSettings={() => setSettingsOpen(true)}
          onPickWorkspace={() => {
            void pickWorkspace();
          }}
          onToggleTheme={toggleTheme}
          onNewThread={clearChat}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />
        <main className={`content-layout ${previewOpen ? "preview-open" : "preview-closed"}`}>
          {previewOpen && (
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
            <AgentPanel
              messages={chatMessages}
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
              onClear={clearChat}
            />
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
