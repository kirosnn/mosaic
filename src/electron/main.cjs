const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");
const { TOPBAR_HEIGHT } = require("./uiConstants.cjs");

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".cache",
  ".idea",
  ".vscode",
  "coverage",
  "target",
  "bin",
  "obj",
]);
const MAX_DIRECTORY_ENTRIES = 1500;
const MAX_READ_FILE_PREVIEW_BYTES = 512 * 1024;
const FS_CHANGE_BATCH_MS = 220;
const DEFAULT_THEME = "dark";
const DEFAULT_WINDOW_MODE = "normal";
const LIGHT_SIDEBAR_COLOR = "#eef2f7";
const LIGHT_WINDOW_BACKGROUND_COLOR = "#eef2f7";
const DARK_WINDOW_BACKGROUND_COLOR = "#000000";
const IS_DEV = !app.isPackaged;

let workspaceRoot = process.cwd();
let mainWindow = null;
let activeChat = null;
let commandBackendWorker = null;
let commandBackendReader = null;
let commandBackendErrorReader = null;
let commandBackendStartPromise = null;
let commandBackendRequestSequence = 0;
const commandBackendPendingRequests = new Map();
let agentBackendWorker = null;
let agentBackendReader = null;
let agentBackendErrorReader = null;
let agentBackendStartPromise = null;
let agentBackendRequestSequence = 0;
const agentBackendPendingRequests = new Map();
let workspaceWatcher = null;
let fsChangeFlushTimer = null;
const pendingFsChanges = new Set();
let userPreferences = {
  workspaceRoot,
  theme: DEFAULT_THEME,
  sidebarOpen: true,
  previewOpen: false,
  windowMode: DEFAULT_WINDOW_MODE,
};

function isTheme(value) {
  return value === "dark" || value === "light";
}

function isWindowMode(value) {
  return value === "normal" || value === "maximized" || value === "fullscreen";
}

function sanitizeWorkspaceRoot(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return process.cwd();
  }
  const resolved = path.resolve(candidate);
  try {
    if (fsSync.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {
  }
  return process.cwd();
}

function getPreferencesFilePath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function sanitizePreferences(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    workspaceRoot: sanitizeWorkspaceRoot(candidate.workspaceRoot),
    theme: isTheme(candidate.theme) ? candidate.theme : DEFAULT_THEME,
    sidebarOpen: typeof candidate.sidebarOpen === "boolean" ? candidate.sidebarOpen : true,
    previewOpen: typeof candidate.previewOpen === "boolean" ? candidate.previewOpen : false,
    windowMode: isWindowMode(candidate.windowMode) ? candidate.windowMode : DEFAULT_WINDOW_MODE,
  };
}

function savePreferences() {
  const filePath = getPreferencesFilePath();
  const payload = {
    ...userPreferences,
    workspaceRoot,
  };
  try {
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    fsSync.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  } catch {
  }
}

function loadPreferences() {
  const filePath = getPreferencesFilePath();
  try {
    const raw = fsSync.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    userPreferences = sanitizePreferences(parsed);
  } catch {
    userPreferences = sanitizePreferences({});
  }
  workspaceRoot = userPreferences.workspaceRoot;
}

function getWindowMode(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) return DEFAULT_WINDOW_MODE;
  if (windowInstance.isFullScreen()) return "fullscreen";
  if (windowInstance.isMaximized()) return "maximized";
  return "normal";
}

function getTitleBarOverlay(theme) {
  const normalizedTheme = theme === "light" ? "light" : "dark";
  return {
    color: normalizedTheme === "light" ? LIGHT_SIDEBAR_COLOR : "#00000000",
    symbolColor: normalizedTheme === "light" ? "#000000" : "#ffffff",
    height: TOPBAR_HEIGHT,
  };
}

function normalizeRelative(relativePath) {
  const normalized = (relativePath || "").replace(/\\/g, "/");
  if (normalized === "." || normalized === "./") return "";
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "");
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveInsideWorkspace(relativePath = "") {
  const normalized = normalizeRelative(relativePath);
  const absolute = path.resolve(workspaceRoot, normalized || ".");
  const relative = path.relative(workspaceRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside workspace");
  }
  return absolute;
}

function sendWindowEvent(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function isIgnoredPath(relativePath) {
  if (!relativePath) return false;
  const parts = normalizeRelative(relativePath).split("/");
  return parts.some((part) => IGNORED_DIRECTORIES.has(part));
}

function flushFsChanges() {
  if (pendingFsChanges.size === 0) return;
  const changes = Array.from(pendingFsChanges.values());
  pendingFsChanges.clear();
  sendWindowEvent("fs:changed", { changes });
}

function queueFsChange(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || isIgnoredPath(normalized)) return;
  pendingFsChanges.add(normalized);
  if (fsChangeFlushTimer) clearTimeout(fsChangeFlushTimer);
  fsChangeFlushTimer = setTimeout(() => {
    fsChangeFlushTimer = null;
    flushFsChanges();
  }, FS_CHANGE_BATCH_MS);
}

function stopWorkspaceWatcher() {
  if (workspaceWatcher) {
    workspaceWatcher.close();
    workspaceWatcher = null;
  }
  if (fsChangeFlushTimer) {
    clearTimeout(fsChangeFlushTimer);
    fsChangeFlushTimer = null;
  }
  pendingFsChanges.clear();
}

function startWorkspaceWatcher() {
  stopWorkspaceWatcher();
  try {
    workspaceWatcher = fsSync.watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      queueFsChange(toPortablePath(String(filename)));
    });
    workspaceWatcher.on("error", (error) => {
      sendWindowEvent("fs:watch-error", { error: error.message });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendWindowEvent("fs:watch-error", { error: message });
  }
}

async function readDirectoryEntries(relativePath = "") {
  const absolutePath = resolveInsideWorkspace(relativePath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !(entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)))
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .map((entry) => {
      const childRelative = normalizeRelative(toPortablePath(path.join(normalizeRelative(relativePath), entry.name)));
      return {
        name: entry.name,
        relativePath: childRelative,
        type: entry.isDirectory() ? "directory" : "file",
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return visibleEntries;
}

async function readFilePreview(relativePath = "") {
  const normalized = normalizeRelative(relativePath);
  const absolutePath = resolveInsideWorkspace(normalized);
  const stat = await fs.stat(absolutePath);
  const totalBytes = Number(stat.size) || 0;

  if (totalBytes <= MAX_READ_FILE_PREVIEW_BYTES) {
    const content = await fs.readFile(absolutePath, "utf8");
    return {
      relativePath: normalized,
      content,
      truncated: false,
      totalBytes,
      previewBytes: totalBytes,
    };
  }

  const fileHandle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_READ_FILE_PREVIEW_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, MAX_READ_FILE_PREVIEW_BYTES, 0);
    const previewBytes = Math.max(0, bytesRead | 0);
    const content = buffer.subarray(0, previewBytes).toString("utf8");
    return {
      relativePath: normalized,
      content,
      truncated: true,
      totalBytes,
      previewBytes,
    };
  } finally {
    await fileHandle.close();
  }
}

function getBunExecutable() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

function buildCommandBackendError(message) {
  return new Error(String(message || "Command backend unavailable"));
}

function rejectAllCommandBackendRequests(error) {
  const pending = Array.from(commandBackendPendingRequests.values());
  commandBackendPendingRequests.clear();
  for (const request of pending) {
    if (request.timeoutId) clearTimeout(request.timeoutId);
    request.reject(error);
  }
}

function teardownCommandBackendWorker() {
  if (commandBackendReader) {
    commandBackendReader.removeAllListeners();
    commandBackendReader.close();
    commandBackendReader = null;
  }
  if (commandBackendErrorReader) {
    commandBackendErrorReader.removeAllListeners();
    commandBackendErrorReader.close();
    commandBackendErrorReader = null;
  }
  commandBackendWorker = null;
}

function stopCommandBackendWorker() {
  rejectAllCommandBackendRequests(buildCommandBackendError("Command backend stopped"));
  const worker = commandBackendWorker;
  teardownCommandBackendWorker();
  if (worker && !worker.killed) {
    worker.kill();
  }
}

function ensureCommandBackendWorker() {
  if (commandBackendWorker && !commandBackendWorker.killed) {
    return Promise.resolve(commandBackendWorker);
  }

  if (commandBackendStartPromise) {
    return commandBackendStartPromise;
  }

  commandBackendStartPromise = new Promise((resolve, reject) => {
    const entry = path.join(__dirname, "backend", "commandWorker.ts");
    const child = spawn(getBunExecutable(), ["run", entry], {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MOSAIC_READONLY: "1",
      },
    });

    let latestStderr = "";
    let settled = false;

    const finalizeStart = (error) => {
      if (settled) return;
      settled = true;
      commandBackendStartPromise = null;
      if (error) {
        reject(error);
      } else {
        resolve(child);
      }
    };

    commandBackendWorker = child;
    commandBackendReader = readline.createInterface({ input: child.stdout });
    commandBackendErrorReader = readline.createInterface({ input: child.stderr });

    commandBackendReader.on("line", (line) => {
      if (!line) return;
      try {
        const payload = JSON.parse(line);
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        if (!requestId) return;
        const pending = commandBackendPendingRequests.get(requestId);
        if (!pending) return;
        commandBackendPendingRequests.delete(requestId);
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.resolve(payload);
      } catch {
      }
    });

    commandBackendErrorReader.on("line", (line) => {
      if (!line) return;
      latestStderr = String(line);
    });

    child.on("error", (error) => {
      const backendError = buildCommandBackendError(error?.message || latestStderr || "Command backend failed to start");
      if (commandBackendWorker === child) {
        teardownCommandBackendWorker();
      }
      rejectAllCommandBackendRequests(backendError);
      finalizeStart(backendError);
    });

    child.on("close", (code, signal) => {
      const details = latestStderr || `Command backend exited (code=${code ?? 0}, signal=${signal ?? "none"})`;
      const backendError = buildCommandBackendError(details);
      if (commandBackendWorker === child) {
        teardownCommandBackendWorker();
      }
      rejectAllCommandBackendRequests(backendError);
      finalizeStart(backendError);
    });

    finalizeStart(null);
  });

  return commandBackendStartPromise;
}

async function requestCommandBackend(action, execute) {
  const child = await ensureCommandBackendWorker();
  if (!child || child.killed || !child.stdin || child.stdin.destroyed || !child.stdin.writable) {
    throw buildCommandBackendError("Command backend stdin is not writable");
  }

  const requestId = `cmd-${Date.now()}-${(commandBackendRequestSequence += 1)}`;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const pending = commandBackendPendingRequests.get(requestId);
      if (!pending) return;
      commandBackendPendingRequests.delete(requestId);
      reject(buildCommandBackendError(`Command backend request timed out (${action})`));
    }, 20_000);

    commandBackendPendingRequests.set(requestId, {
      resolve,
      reject,
      timeoutId,
    });

    const requestPayload = {
      requestId,
      workspaceRoot,
      action,
      execute,
    };

    child.stdin.write(`${JSON.stringify(requestPayload)}\n`, (error) => {
      if (!error) return;
      const pending = commandBackendPendingRequests.get(requestId);
      if (!pending) return;
      commandBackendPendingRequests.delete(requestId);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(buildCommandBackendError(error.message));
    });
  });
}

async function getCommandCatalog() {
  const payload = await requestCommandBackend("catalog");
  if (!payload || payload.ok !== true || !payload.catalog) {
    const message = payload?.error || "Unable to fetch command catalog";
    throw new Error(message);
  }
  return payload.catalog;
}

async function executeDesktopCommand(input, context) {
  const payload = await requestCommandBackend("execute", {
    input,
    context,
  });
  if (!payload || payload.ok !== true || !payload.result) {
    const message = payload?.error || "Unable to execute command";
    throw new Error(message);
  }
  return payload.result;
}

function buildAgentBackendError(message) {
  return new Error(String(message || "Agent backend unavailable"));
}

function rejectAllAgentBackendRequests(error) {
  const pending = Array.from(agentBackendPendingRequests.values());
  agentBackendPendingRequests.clear();
  for (const request of pending) {
    if (request.timeoutId) clearTimeout(request.timeoutId);
    request.reject(error);
  }
}

function teardownAgentBackendWorker() {
  if (agentBackendReader) {
    agentBackendReader.removeAllListeners();
    agentBackendReader.close();
    agentBackendReader = null;
  }
  if (agentBackendErrorReader) {
    agentBackendErrorReader.removeAllListeners();
    agentBackendErrorReader.close();
    agentBackendErrorReader = null;
  }
  agentBackendWorker = null;
}

function handleAgentBackendChatEvent(payload) {
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  if (!requestId) return;
  const eventPayload = payload?.payload && typeof payload.payload === "object" ? payload.payload : null;
  if (!eventPayload) return;

  if (activeChat?.requestId === requestId) {
    const eventType = typeof eventPayload?.type === "string" ? eventPayload.type : "";
    const nestedEvent = eventPayload?.event && typeof eventPayload.event === "object" ? eventPayload.event : null;
    const nestedType = typeof nestedEvent?.type === "string" ? nestedEvent.type : "";
    if (!activeChat.firstTokenReceived && eventType === "event" && nestedType === "text-delta") {
      activeChat.firstTokenReceived = true;
      const latencyMs = Date.now() - activeChat.startedAt;
      if (IS_DEV) {
        console.log(`[electron] chat ttf-token ${latencyMs}ms`);
      }
    }
    if (eventType === "done") {
      activeChat.receivedDone = true;
      activeChat = null;
    }
  }

  sendWindowEvent("chat:event", {
    requestId,
    ...eventPayload,
  });
}

function stopAgentBackendWorker() {
  rejectAllAgentBackendRequests(buildAgentBackendError("Agent backend stopped"));
  const worker = agentBackendWorker;
  teardownAgentBackendWorker();
  if (worker && !worker.killed) {
    worker.kill();
  }
}

function ensureAgentBackendWorker() {
  if (agentBackendWorker && !agentBackendWorker.killed) {
    return Promise.resolve(agentBackendWorker);
  }

  if (agentBackendStartPromise) {
    return agentBackendStartPromise;
  }

  agentBackendStartPromise = new Promise((resolve, reject) => {
    const entry = path.join(__dirname, "backend", "agentWorker.ts");
    const child = spawn(getBunExecutable(), ["run", entry], {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MOSAIC_READONLY: "1",
      },
    });

    let latestStderr = "";
    let settled = false;

    const finalizeStart = (error) => {
      if (settled) return;
      settled = true;
      agentBackendStartPromise = null;
      if (error) {
        reject(error);
      } else {
        resolve(child);
      }
    };

    agentBackendWorker = child;
    agentBackendReader = readline.createInterface({ input: child.stdout });
    agentBackendErrorReader = readline.createInterface({ input: child.stderr });

    agentBackendReader.on("line", (line) => {
      if (!line) return;
      try {
        const payload = JSON.parse(line);
        if (payload?.kind === "chat-event") {
          handleAgentBackendChatEvent(payload);
          return;
        }
        if (payload?.kind !== "response") return;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        if (!requestId) return;
        const pending = agentBackendPendingRequests.get(requestId);
        if (!pending) return;
        agentBackendPendingRequests.delete(requestId);
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.resolve(payload);
      } catch {
      }
    });

    agentBackendErrorReader.on("line", (line) => {
      if (!line) return;
      latestStderr = String(line);
    });

    child.on("error", (error) => {
      const backendError = buildAgentBackendError(error?.message || latestStderr || "Agent backend failed to start");
      if (agentBackendWorker === child) {
        teardownAgentBackendWorker();
      }
      rejectAllAgentBackendRequests(backendError);
      if (activeChat) {
        const requestId = activeChat.requestId;
        const cancelled = activeChat.cancelled;
        activeChat = null;
        sendWindowEvent("chat:event", { requestId, type: "error", source: "backend", error: backendError.message });
        sendWindowEvent("chat:event", { requestId, type: "done", cancelled });
      }
      finalizeStart(backendError);
    });

    child.on("close", (code, signal) => {
      const details = latestStderr || `Agent backend exited (code=${code ?? 0}, signal=${signal ?? "none"})`;
      const backendError = buildAgentBackendError(details);
      if (agentBackendWorker === child) {
        teardownAgentBackendWorker();
      }
      rejectAllAgentBackendRequests(backendError);
      if (activeChat) {
        const requestId = activeChat.requestId;
        const cancelled = activeChat.cancelled;
        activeChat = null;
        sendWindowEvent("chat:event", { requestId, type: "error", source: "backend", error: backendError.message });
        sendWindowEvent("chat:event", { requestId, type: "done", cancelled });
      }
      finalizeStart(backendError);
    });

    finalizeStart(null);
  });

  return agentBackendStartPromise;
}

async function requestAgentBackend(action, payload = {}, forcedRequestId = "") {
  const child = await ensureAgentBackendWorker();
  if (!child || child.killed || !child.stdin || child.stdin.destroyed || !child.stdin.writable) {
    throw buildAgentBackendError("Agent backend stdin is not writable");
  }

  const requestId = forcedRequestId || `agent-${Date.now()}-${(agentBackendRequestSequence += 1)}`;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const pending = agentBackendPendingRequests.get(requestId);
      if (!pending) return;
      agentBackendPendingRequests.delete(requestId);
      reject(buildAgentBackendError(`Agent backend request timed out (${action})`));
    }, 45_000);

    agentBackendPendingRequests.set(requestId, {
      resolve,
      reject,
      timeoutId,
    });

    const requestPayload = {
      requestId,
      workspaceRoot,
      action,
      ...payload,
    };

    child.stdin.write(`${JSON.stringify(requestPayload)}\n`, (error) => {
      if (!error) return;
      const pending = agentBackendPendingRequests.get(requestId);
      if (!pending) return;
      agentBackendPendingRequests.delete(requestId);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(buildAgentBackendError(error.message));
    });
  });
}

async function startChat(messages) {
  if (activeChat) {
    throw new Error("A chat request is already running");
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  activeChat = {
    requestId,
    cancelled: false,
    receivedDone: false,
    firstTokenReceived: false,
    startedAt: Date.now(),
  };

  try {
    const payload = await requestAgentBackend(
      "start",
      {
        messages: Array.isArray(messages) ? messages : [],
      },
      requestId,
    );
    if (!payload || payload.ok !== true) {
      throw new Error(payload?.error || "Unable to start chat");
    }
    return requestId;
  } catch (error) {
    if (activeChat?.requestId === requestId) {
      activeChat = null;
    }
    throw error;
  }
}

async function cancelChat(requestId) {
  if (!activeChat) return false;
  if (activeChat.requestId !== requestId) return false;
  activeChat.cancelled = true;

  try {
    const payload = await requestAgentBackend("cancel", { chatRequestId: requestId });
    if (!payload || payload.ok !== true) {
      return false;
    }
    return payload.cancelled === true;
  } catch {
    return false;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const initialBackgroundColor = userPreferences.theme === "light" ? LIGHT_WINDOW_BACKGROUND_COLOR : DARK_WINDOW_BACKGROUND_COLOR;

  mainWindow = new BrowserWindow({
    show: false,
    width: Math.round(width * 0.8),
    height: Math.round(height * 0.8),
    minWidth: 1200,
    minHeight: 700,
    center: true,
    title: "Mosaic",
    backgroundColor: initialBackgroundColor,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    ...(process.platform !== "darwin"
      ? {
        titleBarOverlay: getTitleBarOverlay(userPreferences.theme),
      }
      : {}),

    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (userPreferences.windowMode === "fullscreen") {
    mainWindow.setFullScreen(true);
  } else if (userPreferences.windowMode === "maximized") {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });

  if (IS_DEV) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
      if (input.type === "keyDown" && key === "f12") {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.toggleDevTools();
        }
        event.preventDefault();
      }
    });
  }

  mainWindow.on("close", () => {
    userPreferences.windowMode = getWindowMode(mainWindow);
    userPreferences.workspaceRoot = workspaceRoot;
    savePreferences();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("workspace:get", async () => {
  return { workspaceRoot };
});

ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Workspace",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { changed: false, workspaceRoot };
  }

  workspaceRoot = result.filePaths[0];
  userPreferences.workspaceRoot = workspaceRoot;
  savePreferences();
  startWorkspaceWatcher();
  sendWindowEvent("workspace:changed", { workspaceRoot });
  return { changed: true, workspaceRoot };
});

ipcMain.handle("preferences:get", async () => {
  return {
    theme: userPreferences.theme,
    sidebarOpen: userPreferences.sidebarOpen,
    previewOpen: userPreferences.previewOpen,
    workspaceRoot,
    windowMode: userPreferences.windowMode,
  };
});

ipcMain.handle("preferences:set", async (_event, payload) => {
  const patch = payload && typeof payload === "object" ? payload : {};
  let changed = false;

  if (isTheme(patch.theme) && patch.theme !== userPreferences.theme) {
    userPreferences.theme = patch.theme;
    changed = true;
  }
  if (typeof patch.sidebarOpen === "boolean" && patch.sidebarOpen !== userPreferences.sidebarOpen) {
    userPreferences.sidebarOpen = patch.sidebarOpen;
    changed = true;
  }
  if (typeof patch.previewOpen === "boolean" && patch.previewOpen !== userPreferences.previewOpen) {
    userPreferences.previewOpen = patch.previewOpen;
    changed = true;
  }

  if (changed) {
    savePreferences();
  }

  return {
    theme: userPreferences.theme,
    sidebarOpen: userPreferences.sidebarOpen,
    previewOpen: userPreferences.previewOpen,
    workspaceRoot,
    windowMode: userPreferences.windowMode,
  };
});

ipcMain.handle("fs:readDir", async (_event, payload) => {
  const relativePath = payload?.relativePath ?? "";
  return readDirectoryEntries(relativePath);
});

ipcMain.handle("fs:readFile", async (_event, payload) => {
  const relativePath = payload?.relativePath ?? "";
  return readFilePreview(relativePath);
});

ipcMain.handle("fs:writeFile", async (_event, payload) => {
  throw new Error("Read-only mode: writing files is disabled in Mosaic");
});

ipcMain.handle("fs:createFile", async (_event, payload) => {
  throw new Error("Read-only mode: file creation is disabled in Mosaic");
});

ipcMain.handle("fs:createDirectory", async (_event, payload) => {
  throw new Error("Read-only mode: directory creation is disabled in Mosaic");
});

ipcMain.handle("chat:start", async (_event, payload) => {
  return { requestId: await startChat(payload?.messages ?? []) };
});

ipcMain.handle("chat:cancel", async (_event, payload) => {
  return { cancelled: await cancelChat(payload?.requestId ?? "") };
});

ipcMain.handle("command:catalog", async () => {
  return getCommandCatalog();
});

ipcMain.handle("command:execute", async (_event, payload) => {
  const input = typeof payload?.input === "string" ? payload.input : "";
  const context = payload?.context && typeof payload.context === "object" ? payload.context : undefined;
  return executeDesktopCommand(input, context);
});

ipcMain.handle("ui:get-constants", async () => {
  return {
    topbarHeight: TOPBAR_HEIGHT,
    isDev: IS_DEV,
  };
});

ipcMain.on("window:set-theme", (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === "darwin") return;
  const theme = payload?.theme === "light" ? "light" : "dark";
  mainWindow.setTitleBarOverlay(getTitleBarOverlay(theme));
  mainWindow.setBackgroundColor(theme === "light" ? LIGHT_WINDOW_BACKGROUND_COLOR : DARK_WINDOW_BACKGROUND_COLOR);
});

app.whenReady().then(() => {
  loadPreferences();
  createWindow();
  startWorkspaceWatcher();
  void ensureCommandBackendWorker().catch(() => {});
  void ensureAgentBackendWorker().catch(() => {});

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopWorkspaceWatcher();
  stopCommandBackendWorker();
  stopAgentBackendWorker();
  activeChat = null;
});
