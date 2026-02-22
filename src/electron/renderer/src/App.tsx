import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { EditorPanel } from "./components/EditorPanel";
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
  const [activeRequestId, setActiveRequestId] = useState("");
  const [activeAssistantId, setActiveAssistantId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const activeRequestIdRef = useRef("");
  const activeAssistantIdRef = useRef("");
  const pendingToolCallsRef = useRef<Map<string, PendingToolCall>>(new Map());
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const preferencesLoadedRef = useRef(false);

  useEffect(() => {
    directoryCacheRef.current = directoryCache;
  }, [directoryCache]);

  useEffect(() => {
    activeRequestIdRef.current = activeRequestId;
  }, [activeRequestId]);

  useEffect(() => {
    activeAssistantIdRef.current = activeAssistantId;
  }, [activeAssistantId]);

  const chatRunning = useMemo(() => Boolean(activeRequestId), [activeRequestId]);
  const themeLabel = useMemo(() => getThemeLabel(theme), [theme]);
  const logoSrc = useMemo(() => getLogoSrc(theme), [theme]);
  const commandCompletions = useMemo(
    () => computeCommandCompletions(chatInput, commandCatalog),
    [chatInput, commandCatalog],
  );

  const setStatus = useCallback((text: string, error = false) => {
    setEditorStatus({ text, error });
  }, []);

  const refreshCommandCatalog = useCallback(async () => {
    try {
      const catalog = await api.getCommandCatalog();
      setCommandCatalog(catalog);
    } catch {
      setCommandCatalog(null);
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

  const refreshTree = useCallback(async () => {
    setDirectoryCache({});
    directoryCacheRef.current = {};
    setOpenDirectories(new Set([""]));
    const rootEntries = await api.readDir("");
    setDirectoryCache({ "": rootEntries });
  }, []);

  const openFile = useCallback(async (relativePath: string) => {
    const normalized = normalizeRelative(relativePath);
    if (!normalized) return;
    setCurrentFile(normalized);
    setPreviewOpen(true);
    if (getMediaKind(normalized)) {
      setEditorValue("");
      setStatus("File loaded");
      return;
    }
    try {
      const file = await api.readFile(normalized);
      setCurrentFile(normalizeRelative(file.relativePath));
      setEditorValue(file.content);
      setStatus("File loaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot open file";
      setStatus(message, true);
    }
  }, [setStatus]);

  const closeCurrentFile = useCallback(() => {
    setCurrentFile("");
    setEditorValue("");
    setStatus("Ready");
  }, [setStatus]);

  const toggleDirectory = useCallback(async (relativePath: string) => {
    const normalized = normalizeRelative(relativePath);
    const isOpen = openDirectories.has(normalized);
    if (isOpen) {
      setOpenDirectories((prev) => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
      return;
    }
    setOpenDirectories((prev) => {
      const next = new Set(prev);
      next.add(normalized);
      return next;
    });
    await ensureDirLoaded(normalized);
  }, [ensureDirLoaded, openDirectories]);

  const finalizeChatRun = useCallback((statusText: string) => {
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
        next.push({
          id: createId("system"),
          role: "system",
          content: statusText,
        });
      }
      return next;
    });
    pendingToolCallsRef.current.clear();
    setActiveRequestId("");
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");
  }, []);

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
      return;
    }

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
  }, [appendChatMessage, updateChatMessage]);

  const sendChat = useCallback(async () => {
    if (activeRequestIdRef.current) return;
    const prompt = chatInput.trim();
    if (!prompt) return;

    setChatInput("");
    if (prompt.startsWith("/")) {
      await executeLocalCommand(prompt);
      return;
    }

    const history = buildAgentHistory(chatMessages);
    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: prompt,
    };

    setChatMessages((prev) => [...prev, userMessage]);
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");

    try {
      const response = await api.startChat([...history, { role: "user", content: prompt }]);
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
  }, [appendChatMessage, chatInput, chatMessages, executeLocalCommand, finalizeChatRun]);

  const stopChat = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    try {
      await api.cancelChat(requestId);
    } finally {
      finalizeChatRun("Generation cancelled.");
    }
  }, [finalizeChatRun]);

  const clearChat = useCallback(() => {
    if (activeRequestIdRef.current) return;
    pendingToolCallsRef.current.clear();
    setChatMessages([]);
    setChatInput("");
    activeAssistantIdRef.current = "";
    setActiveAssistantId("");
  }, []);

  const applyCompletion = useCallback((completion: CommandCompletionItem) => {
    setChatInput((prev) => applyCommandCompletion(prev, completion.token));
  }, []);

  const pickWorkspace = useCallback(async () => {
    const result = await api.pickWorkspace();
    if (!result.changed) return;
    setWorkspaceRoot(result.workspaceRoot ?? "");
    setCurrentFile("");
    setEditorValue("");
    await refreshTree();
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
        await refreshTree();
        await refreshCommandCatalog();
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
        finalizeChatRun(payload.cancelled ? "Request stopped." : "");
      }
    });
    return unsubscribe;
  }, [appendChatMessage, finalizeChatRun, handleAgentEvent]);

  useEffect(() => {
    const unsubscribe = api.onWorkspaceChanged(async (payload) => {
      setWorkspaceRoot(payload.workspaceRoot ?? "");
      setCurrentFile("");
      setEditorValue("");
      await refreshTree();
      await refreshCommandCatalog();
      setStatus("Workspace changed");
    });
    return unsubscribe;
  }, [refreshCommandCatalog, refreshTree, setStatus]);

  useEffect(() => {
    const unsubscribe = api.onFsChanged(async (payload) => {
      const changes = Array.isArray(payload?.changes) ? payload.changes : [];
      const catalogTouched = changes.some((entry) => {
        const normalized = normalizeRelative(entry).toLowerCase();
        return normalized.startsWith(".mosaic/skills/");
      });
      await refreshTree();
      if (catalogTouched) {
        await refreshCommandCatalog();
      }

      if (!currentFile) {
        setStatus("Workspace refreshed");
        return;
      }

      const shouldReloadCurrent = changes.length === 0 || changes.some((entry) => {
        const normalized = normalizeRelative(entry);
        return normalized === currentFile || normalized.startsWith(`${currentFile}/`) || currentFile.startsWith(`${normalized}/`);
      });

      if (shouldReloadCurrent) {
        await openFile(currentFile);
        setStatus("File updated from disk");
      }
    });
    return unsubscribe;
  }, [currentFile, openFile, refreshCommandCatalog, refreshTree, setStatus]);

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
    chatLog.scrollTop = chatLog.scrollHeight;
  }, [chatMessages]);

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
              workspaceRoot={workspaceRoot}
              directoryCache={directoryCache}
              openDirectories={openDirectories}
              onToggleDirectory={(path) => {
                void toggleDirectory(path);
              }}
              onOpenFile={(path) => {
                void openFile(path);
              }}
              onCloseFile={closeCurrentFile}
            />
          )}
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
