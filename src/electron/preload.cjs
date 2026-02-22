const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  getPlatform: () => process.platform,
  setWindowTheme: (theme) => ipcRenderer.send("window:set-theme", { theme }),
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  setPreferences: (patch) => ipcRenderer.invoke("preferences:set", patch),
  getUiConstants: () => ipcRenderer.invoke("ui:get-constants"),
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  readDir: (relativePath) => ipcRenderer.invoke("fs:readDir", { relativePath }),
  readFile: (relativePath) => ipcRenderer.invoke("fs:readFile", { relativePath }),
  startChat: (messages) => ipcRenderer.invoke("chat:start", { messages }),
  cancelChat: (requestId) => ipcRenderer.invoke("chat:cancel", { requestId }),
  onChatEvent: (callback) => subscribe("chat:event", callback),
  onWorkspaceChanged: (callback) => subscribe("workspace:changed", callback),
  onFsChanged: (callback) => subscribe("fs:changed", callback),
  onFsWatchError: (callback) => subscribe("fs:watch-error", callback),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("mosaicDesktop", api);
} else {
  window.mosaicDesktop = api;
}
