const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");
const { TOPBAR_HEIGHT } = require("./uiConstants.cjs");

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".turbo", "dist", "build"]);
const MAX_DIRECTORY_ENTRIES = 1500;
const DEFAULT_THEME = "dark";
const DEFAULT_WINDOW_MODE = "normal";
const LIGHT_SIDEBAR_COLOR = "#eef2f7";
const IS_DEV = !app.isPackaged;

let workspaceRoot = process.cwd();
let mainWindow = null;
let activeChat = null;
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
  }, 120);
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

function startChat(messages) {
  if (activeChat) {
    throw new Error("A chat request is already running");
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const bunExecutable = process.platform === "win32" ? "bun.exe" : "bun";
  const backendEntry = path.join(__dirname, "backend", "agentBackend.ts");
  const child = spawn(bunExecutable, ["run", backendEntry], {
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      MOSAIC_READONLY: "1",
    },
  });

  activeChat = {
    requestId,
    child,
    cancelled: false,
    receivedDone: false,
  };

  const stdoutReader = readline.createInterface({ input: child.stdout });
  const stderrReader = readline.createInterface({ input: child.stderr });

  stdoutReader.on("line", (line) => {
    if (!line || activeChat?.requestId !== requestId) return;
    try {
      const payload = JSON.parse(line);
      if (payload?.type === "done" && activeChat?.requestId === requestId) {
        activeChat.receivedDone = true;
      }
      sendWindowEvent("chat:event", { requestId, ...payload });
    } catch {
      sendWindowEvent("chat:event", { requestId, type: "error", error: line });
    }
  });

  stderrReader.on("line", (line) => {
    if (!line || activeChat?.requestId !== requestId) return;
    sendWindowEvent("chat:event", { requestId, type: "error", error: line });
  });

  child.on("error", (error) => {
    if (activeChat?.requestId !== requestId) return;
    sendWindowEvent("chat:event", { requestId, type: "error", error: error.message });
  });

  child.on("close", (code, signal) => {
    if (activeChat?.requestId === requestId) {
      const cancelled = activeChat.cancelled;
      const receivedDone = activeChat.receivedDone;
      activeChat = null;
      if (!receivedDone) {
        sendWindowEvent("chat:event", {
          requestId,
          type: "done",
          code: code ?? 0,
          signal: signal ?? null,
          cancelled,
        });
      }
    }
    stdoutReader.close();
    stderrReader.close();
  });

  const inputPayload = JSON.stringify({
    workspaceRoot,
    messages: Array.isArray(messages) ? messages : [],
  });
  child.stdin.write(inputPayload);
  child.stdin.end();

  return requestId;
}

function cancelChat(requestId) {
  if (!activeChat) return false;
  if (activeChat.requestId !== requestId) return false;
  activeChat.cancelled = true;
  activeChat.child.kill();
  return true;
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.round(width * 0.8),
    height: Math.round(height * 0.8),
    minWidth: 1200,
    minHeight: 700,
    center: true,
    title: "Mosaic",
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
  const absolutePath = resolveInsideWorkspace(relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  return { relativePath: normalizeRelative(relativePath), content };
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
  return { requestId: startChat(payload?.messages ?? []) };
});

ipcMain.handle("chat:cancel", async (_event, payload) => {
  return { cancelled: cancelChat(payload?.requestId ?? "") };
});

ipcMain.handle("ui:get-constants", async () => {
  return { topbarHeight: TOPBAR_HEIGHT };
});

ipcMain.on("window:set-theme", (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === "darwin") return;
  const theme = payload?.theme === "light" ? "light" : "dark";
  mainWindow.setTitleBarOverlay(getTitleBarOverlay(theme));
});

app.whenReady().then(() => {
  loadPreferences();
  createWindow();
  startWorkspaceWatcher();

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
  if (activeChat) {
    activeChat.cancelled = true;
    activeChat.child.kill();
    activeChat = null;
  }
});
