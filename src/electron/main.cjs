const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");
const { homedir } = require("os");
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
const MAX_FS_CHANGE_BATCH_SIZE = 500;
const DIRECTORY_CACHE_TTL_MS = 1500;
const DIRECTORY_CACHE_MAX_ENTRIES = 800;
const FILE_PREVIEW_CACHE_TTL_MS = 1500;
const FILE_PREVIEW_CACHE_MAX_ENTRIES = 80;
const DEFAULT_THEME = "dark";
const DEFAULT_WINDOW_MODE = "normal";
const LIGHT_SIDEBAR_COLOR = "#eef2f7";
const LIGHT_WINDOW_BACKGROUND_COLOR = "#eef2f7";
const DARK_WINDOW_BACKGROUND_COLOR = "#000000";
const IS_DEV = !app.isPackaged;
const HISTORY_LAST_FILENAME = "last.txt";

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
const directoryEntryCache = new Map();
const pendingDirectoryReads = new Map();
const filePreviewCache = new Map();
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
  const changes = pendingFsChanges.size > MAX_FS_CHANGE_BATCH_SIZE
    ? []
    : Array.from(pendingFsChanges.values());
  pendingFsChanges.clear();
  sendWindowEvent("fs:changed", { changes });
}

function trimCacheMap(cache, maxEntries) {
  if (cache.size <= maxEntries) return;
  const keys = Array.from(cache.keys());
  const overflow = cache.size - maxEntries;
  for (let index = 0; index < overflow; index += 1) {
    const key = keys[index];
    if (key !== undefined) {
      cache.delete(key);
    }
  }
}

function clearFsCaches() {
  directoryEntryCache.clear();
  pendingDirectoryReads.clear();
  filePreviewCache.clear();
}

function getParentRelativePath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) return "";
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  return normalized.slice(0, index);
}

function invalidateFsCachesForPath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) {
    clearFsCaches();
    return;
  }
  const parent = getParentRelativePath(normalized);
  directoryEntryCache.delete(normalized);
  directoryEntryCache.delete(parent);
  filePreviewCache.delete(normalized);
}

function queueFsChange(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || isIgnoredPath(normalized)) return;
  invalidateFsCachesForPath(normalized);
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
  const normalized = normalizeRelative(relativePath);
  const now = Date.now();
  const cached = directoryEntryCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.entries;
  }

  const inflight = pendingDirectoryReads.get(normalized);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const absolutePath = resolveInsideWorkspace(normalized);
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const visibleEntries = entries
      .filter((entry) => !(entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)))
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => {
        const childRelative = normalizeRelative(toPortablePath(path.join(normalized, entry.name)));
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

    directoryEntryCache.set(normalized, {
      expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS,
      entries: visibleEntries,
    });
    trimCacheMap(directoryEntryCache, DIRECTORY_CACHE_MAX_ENTRIES);
    return visibleEntries;
  })();

  pendingDirectoryReads.set(normalized, request);
  try {
    return await request;
  } finally {
    pendingDirectoryReads.delete(normalized);
  }
}

async function readFilePreview(relativePath = "") {
  const normalized = normalizeRelative(relativePath);
  const now = Date.now();
  const cached = filePreviewCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const absolutePath = resolveInsideWorkspace(normalized);
  const stat = await fs.stat(absolutePath);
  const totalBytes = Number(stat.size) || 0;
  let payload;

  if (totalBytes <= MAX_READ_FILE_PREVIEW_BYTES) {
    const content = await fs.readFile(absolutePath, "utf8");
    payload = {
      relativePath: normalized,
      content,
      truncated: false,
      totalBytes,
      previewBytes: totalBytes,
    };
  } else {
    const fileHandle = await fs.open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(MAX_READ_FILE_PREVIEW_BYTES);
      const { bytesRead } = await fileHandle.read(buffer, 0, MAX_READ_FILE_PREVIEW_BYTES, 0);
      const previewBytes = Math.max(0, bytesRead | 0);
      const content = buffer.subarray(0, previewBytes).toString("utf8");
      payload = {
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

  filePreviewCache.set(normalized, {
    expiresAt: Date.now() + FILE_PREVIEW_CACHE_TTL_MS,
    totalBytes,
    mtimeMs: Number(stat.mtimeMs) || 0,
    payload,
  });
  trimCacheMap(filePreviewCache, FILE_PREVIEW_CACHE_MAX_ENTRIES);
  return payload;
}

function setWorkspaceRoot(nextWorkspaceRoot, options = {}) {
  const normalized = sanitizeWorkspaceRoot(nextWorkspaceRoot);
  if (normalized === workspaceRoot) {
    return { changed: false, workspaceRoot };
  }
  workspaceRoot = normalized;
  userPreferences.workspaceRoot = workspaceRoot;
  clearFsCaches();
  savePreferences();
  startWorkspaceWatcher();
  if (options.emitEvent !== false) {
    sendWindowEvent("workspace:changed", { workspaceRoot });
  }
  return { changed: true, workspaceRoot };
}

function getHistoryDir() {
  const historyDir = path.join(homedir(), ".mosaic", "history");
  if (!fsSync.existsSync(historyDir)) {
    fsSync.mkdirSync(historyDir, { recursive: true });
  }
  return historyDir;
}

function getLastConversationFilePath() {
  return path.join(getHistoryDir(), HISTORY_LAST_FILENAME);
}

function sanitizeConversationId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return "";
  return id;
}

function getConversationFilePath(id) {
  const safeId = sanitizeConversationId(id);
  if (!safeId) {
    throw new Error("Invalid conversation id");
  }
  return path.join(getHistoryDir(), `${safeId}.json`);
}

function normalizeConversationStep(input, fallbackTimestamp) {
  if (!input || typeof input !== "object") return null;
  const type = (
    input.type === "user"
    || input.type === "assistant"
    || input.type === "tool"
    || input.type === "system"
  )
    ? input.type
    : "";
  if (!type) return null;
  const content = typeof input.content === "string" ? input.content : String(input.content ?? "");
  const timestampValue = Number(input.timestamp);
  const timestamp = Number.isFinite(timestampValue) && timestampValue > 0 ? Math.floor(timestampValue) : fallbackTimestamp;
  const step = {
    ...input,
    type,
    content,
    timestamp,
  };
  return step;
}

function normalizeConversationRecord(input, fallbackTimestamp = Date.now()) {
  if (!input || typeof input !== "object") return null;
  const id = sanitizeConversationId(input.id);
  if (!id) return null;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps = rawSteps
    .map((step, index) => normalizeConversationStep(step, fallbackTimestamp + index))
    .filter(Boolean);
  const timestampValue = Number(input.timestamp);
  const timestamp = Number.isFinite(timestampValue) && timestampValue > 0 ? Math.floor(timestampValue) : fallbackTimestamp;

  const record = {
    ...input,
    id,
    timestamp,
    steps,
    totalSteps: Number.isFinite(Number(input.totalSteps)) && Number(input.totalSteps) >= 0
      ? Math.floor(Number(input.totalSteps))
      : steps.length,
  };

  if (typeof input.title === "string" || input.title === null) {
    record.title = input.title;
  }
  if (typeof input.workspace === "string" || input.workspace === null) {
    record.workspace = input.workspace;
  }
  if (typeof input.model === "string") {
    record.model = input.model;
  }
  if (typeof input.provider === "string") {
    record.provider = input.provider;
  }
  if (typeof input.titleEdited === "boolean") {
    record.titleEdited = input.titleEdited;
  }
  if (input.totalTokens && typeof input.totalTokens === "object") {
    const prompt = Number(input.totalTokens.prompt);
    const completion = Number(input.totalTokens.completion);
    const total = Number(input.totalTokens.total);
    if (Number.isFinite(prompt) && Number.isFinite(completion) && Number.isFinite(total)) {
      record.totalTokens = {
        prompt: Math.max(0, Math.floor(prompt)),
        completion: Math.max(0, Math.floor(completion)),
        total: Math.max(0, Math.floor(total)),
      };
    }
  }

  return record;
}

function areConversationStepsEquivalent(left, right) {
  if (!left || !right) return false;
  if (left.type !== right.type) return false;
  if (String(left.content || "") !== String(right.content || "")) return false;
  return true;
}

function mergeConversationSteps(existingSteps, nextSteps) {
  const existing = Array.isArray(existingSteps) ? existingSteps : [];
  const incoming = Array.isArray(nextSteps) ? nextSteps : [];
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  const merged = [];
  let existingIndex = 0;

  for (const step of incoming) {
    const currentExisting = existing[existingIndex];
    if (currentExisting && currentExisting.type === step.type) {
      merged.push({ ...currentExisting, ...step });
      existingIndex += 1;
      continue;
    }

    let matchedIndex = -1;
    for (let cursor = existingIndex; cursor < existing.length; cursor += 1) {
      if (areConversationStepsEquivalent(existing[cursor], step)) {
        matchedIndex = cursor;
        break;
      }
    }

    if (matchedIndex >= 0) {
      for (let cursor = existingIndex; cursor < matchedIndex; cursor += 1) {
        merged.push(existing[cursor]);
      }
      merged.push({ ...existing[matchedIndex], ...step });
      existingIndex = matchedIndex + 1;
      continue;
    }

    merged.push(step);
  }

  for (let cursor = existingIndex; cursor < existing.length; cursor += 1) {
    merged.push(existing[cursor]);
  }

  return merged;
}

function getLastConversationId() {
  const filepath = getLastConversationFilePath();
  if (!fsSync.existsSync(filepath)) return null;
  try {
    const value = String(fsSync.readFileSync(filepath, "utf8") || "").trim();
    return value || null;
  } catch {
    return null;
  }
}

function setLastConversationId(id) {
  const value = sanitizeConversationId(id);
  if (!value) return;
  const filepath = getLastConversationFilePath();
  try {
    fsSync.writeFileSync(filepath, value, "utf8");
  } catch {
  }
}

function clearLastConversationId() {
  const filepath = getLastConversationFilePath();
  try {
    fsSync.writeFileSync(filepath, "", "utf8");
  } catch {
  }
}

function listConversationHistory() {
  const historyDir = getHistoryDir();
  const files = fsSync.readdirSync(historyDir)
    .filter((file) => file.endsWith(".json") && file !== "inputs.json");
  const conversations = [];

  for (const file of files) {
    const filepath = path.join(historyDir, file);
    try {
      const raw = fsSync.readFileSync(filepath, "utf8");
      const parsed = JSON.parse(raw);
      const fallbackTimestamp = (() => {
        try {
          const stat = fsSync.statSync(filepath);
          return Math.floor(stat.mtimeMs || Date.now());
        } catch {
          return Date.now();
        }
      })();
      const normalized = normalizeConversationRecord(parsed, fallbackTimestamp);
      if (!normalized || !Array.isArray(normalized.steps)) continue;
      conversations.push(normalized);
    } catch {
    }
  }

  conversations.sort((a, b) => b.timestamp - a.timestamp);
  return {
    conversations,
    lastConversationId: getLastConversationId(),
  };
}

function saveConversationHistory(conversation) {
  const normalized = normalizeConversationRecord(conversation, Date.now());
  if (!normalized) {
    throw new Error("Invalid conversation payload");
  }
  const filepath = getConversationFilePath(normalized.id);
  let finalRecord = normalized;
  if (fsSync.existsSync(filepath)) {
    try {
      const existingRaw = fsSync.readFileSync(filepath, "utf8");
      const existingParsed = JSON.parse(existingRaw);
      const existing = normalizeConversationRecord(existingParsed, normalized.timestamp);
      if (existing) {
        const mergedSteps = mergeConversationSteps(existing.steps, normalized.steps);
        finalRecord = {
          ...existing,
          ...normalized,
          timestamp: Math.max(Number(existing.timestamp) || 0, Number(normalized.timestamp) || 0),
          steps: mergedSteps,
          totalSteps: mergedSteps.length,
        };
        if ((finalRecord.title === undefined || finalRecord.title === null || finalRecord.title === "") && existing.title) {
          finalRecord.title = existing.title;
        }
        if ((finalRecord.workspace === undefined || finalRecord.workspace === null || finalRecord.workspace === "") && existing.workspace) {
          finalRecord.workspace = existing.workspace;
        }
        if (!finalRecord.model && existing.model) {
          finalRecord.model = existing.model;
        }
        if (!finalRecord.provider && existing.provider) {
          finalRecord.provider = existing.provider;
        }
        if (!finalRecord.totalTokens && existing.totalTokens) {
          finalRecord.totalTokens = existing.totalTokens;
        }
        if (typeof finalRecord.titleEdited !== "boolean" && typeof existing.titleEdited === "boolean") {
          finalRecord.titleEdited = existing.titleEdited;
        }
      }
    } catch {
    }
  }
  fsSync.writeFileSync(filepath, JSON.stringify(finalRecord, null, 2), "utf8");
  setLastConversationId(finalRecord.id);
  return { ok: true };
}

function renameConversationHistory(id, title) {
  const safeId = sanitizeConversationId(id);
  const nextTitle = typeof title === "string" ? title.trim() : "";
  if (!safeId || !nextTitle) {
    throw new Error("Invalid rename payload");
  }
  const filepath = getConversationFilePath(safeId);
  if (!fsSync.existsSync(filepath)) {
    return { ok: false };
  }
  const fallbackTimestamp = (() => {
    try {
      const stat = fsSync.statSync(filepath);
      return Math.floor(stat.mtimeMs || Date.now());
    } catch {
      return Date.now();
    }
  })();
  const raw = fsSync.readFileSync(filepath, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = normalizeConversationRecord(parsed, fallbackTimestamp);
  if (!normalized) {
    return { ok: false };
  }
  normalized.title = nextTitle;
  normalized.titleEdited = true;
  fsSync.writeFileSync(filepath, JSON.stringify(normalized, null, 2), "utf8");
  return { ok: true };
}

function deleteConversationHistory(id) {
  const safeId = sanitizeConversationId(id);
  if (!safeId) {
    throw new Error("Invalid conversation id");
  }
  const filepath = getConversationFilePath(safeId);
  if (fsSync.existsSync(filepath)) {
    fsSync.unlinkSync(filepath);
  }
  const lastConversationId = getLastConversationId();
  if (lastConversationId === safeId) {
    const fallback = listConversationHistory().conversations[0];
    if (fallback?.id) {
      setLastConversationId(fallback.id);
    } else {
      clearLastConversationId();
    }
  }
  return { ok: true };
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

  return setWorkspaceRoot(result.filePaths[0], { emitEvent: true });
});

ipcMain.handle("workspace:set", async (_event, payload) => {
  const requested = typeof payload?.workspaceRoot === "string" ? payload.workspaceRoot : "";
  return setWorkspaceRoot(requested, { emitEvent: true });
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

ipcMain.handle("history:list", async () => {
  return listConversationHistory();
});

ipcMain.handle("history:save", async (_event, payload) => {
  return saveConversationHistory(payload?.conversation);
});

ipcMain.handle("history:rename", async (_event, payload) => {
  return renameConversationHistory(payload?.id, payload?.title);
});

ipcMain.handle("history:delete", async (_event, payload) => {
  return deleteConversationHistory(payload?.id);
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
