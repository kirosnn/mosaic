const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const electronBinary = require("electron");

const projectRoot = path.resolve(__dirname, "..", "..");
const electronEntry = path.join(__dirname, "main.cjs");
const rendererDistDir = path.join(__dirname, "renderer", "dist");
const rendererDistPackageJson = path.join(rendererDistDir, "package.json");

const watchTargets = [
  path.join(__dirname, "main.cjs"),
  path.join(__dirname, "preload.cjs"),
  path.join(__dirname, "uiConstants.cjs"),
  path.join(__dirname, "backend"),
  path.join(__dirname, "renderer", "src"),
  path.join(__dirname, "renderer", "styles"),
  path.join(__dirname, "renderer", "index.html"),
  path.join(projectRoot, "tsconfig.electron.renderer.json"),
];

let electronProcess = null;
let restarting = false;
let restartQueued = false;
let shutdownRequested = false;
let debounceTimer = null;
const pendingChanges = new Set();
const watchers = [];

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });

    child.on("error", (error) => {
      console.error(`[electron:dev] Failed to start ${command}: ${error.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

function ensureRendererDistPackage() {
  fs.mkdirSync(rendererDistDir, { recursive: true });
  fs.writeFileSync(rendererDistPackageJson, '{"type":"commonjs"}\n', "utf8");
}

async function buildRenderer() {
  console.log("[electron:dev] Building renderer...");
  const ok = await runCommand("bunx", ["tsc", "-p", "tsconfig.electron.renderer.json"]);
  if (!ok) {
    console.error("[electron:dev] Renderer build failed. Waiting for next change.");
    return false;
  }
  ensureRendererDistPackage();
  return true;
}

function startElectron() {
  if (shutdownRequested) return;
  if (typeof electronBinary !== "string" || !electronBinary) {
    console.error("[electron:dev] Unable to resolve Electron binary.");
    return;
  }
  console.log("[electron:dev] Launching Electron...");
  const child = spawn(electronBinary, [electronEntry], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  electronProcess = child;

  child.on("error", (error) => {
    console.error(`[electron:dev] Electron failed to start: ${error.message}`);
  });

  child.on("close", (code, signal) => {
    if (electronProcess === child) {
      electronProcess = null;
    }
    if (!shutdownRequested) {
      const codeLabel = typeof code === "number" ? String(code) : "null";
      const signalLabel = signal ?? "null";
      console.log(`[electron:dev] Electron exited (code=${codeLabel}, signal=${signalLabel}).`);
    }
  });
}

function stopElectron() {
  if (!electronProcess) return Promise.resolve();
  const child = electronProcess;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    child.once("close", finish);
    child.kill();

    setTimeout(() => {
      if (!done) {
        if (process.platform === "win32" && child.pid) {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
            shell: false,
          });
          killer.on("close", finish);
          killer.on("error", finish);
          return;
        }
        child.kill("SIGKILL");
      }
    }, 1200);
  });
}

async function restartElectron(reason) {
  if (shutdownRequested) return;
  if (restarting) {
    restartQueued = true;
    return;
  }

  restarting = true;

  do {
    restartQueued = false;
    console.log(`[electron:dev] Restarting app (${reason})`);
    const built = await buildRenderer();
    if (!built || shutdownRequested) {
      continue;
    }
    await stopElectron();
    if (!shutdownRequested) {
      startElectron();
    }
  } while (restartQueued && !shutdownRequested);

  restarting = false;
}

function scheduleRestart(changedPath) {
  if (shutdownRequested) return;
  const relative = path.relative(projectRoot, changedPath).replace(/\\/g, "/");
  pendingChanges.add(relative || changedPath);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const reason = Array.from(pendingChanges).slice(0, 5).join(", ");
    pendingChanges.clear();
    void restartElectron(reason || "file change");
  }, 180);
}

function registerWatcher(targetPath) {
  let stat = null;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return;
  }

  const isDirectory = stat.isDirectory();
  const watcher = fs.watch(
    targetPath,
    { recursive: isDirectory },
    (_eventType, filename) => {
      const changedPath = filename ? path.join(targetPath, String(filename)) : targetPath;
      scheduleRestart(changedPath);
    }
  );

  watcher.on("error", (error) => {
    console.error(`[electron:dev] Watch error on ${targetPath}: ${error.message}`);
  });

  watchers.push(watcher);
}

function closeWatchers() {
  for (const watcher of watchers) {
    watcher.close();
  }
  watchers.length = 0;
}

async function shutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  closeWatchers();
  await stopElectron();
}

async function main() {
  for (const target of watchTargets) {
    registerWatcher(target);
  }

  const built = await buildRenderer();
  if (built) {
    startElectron();
  }
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

process.on("exit", () => {
  closeWatchers();
});

void main();
