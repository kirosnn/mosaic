import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { debugLog } from "./debug";

const execAsync = promisify(exec);
const DISCOVERY_CACHE_TTL_MS = 300_000;

type DiscoveryCacheEntry = {
  timestamp: number;
  promise: Promise<SubsystemInfo[]>;
};

const discoveryCache: Map<string, DiscoveryCacheEntry> = new Map();

export type SubsystemId =
  | "auto"
  | "powershell"
  | "pwsh"
  | "cmd"
  | "wsl"
  | "git-bash"
  | "bash";

export interface SubsystemInfo {
  id: SubsystemId;
  label: string;
  available: boolean;
  executable?: string;
  details?: string;
  priority: number;
}

export interface SubsystemStatusSnapshot {
  preferred: string;
  effective: SubsystemInfo;
  available: SubsystemInfo[];
  unavailable: SubsystemInfo[];
  fallbackOrder: SubsystemInfo[];
  all: SubsystemInfo[];
}

const SUBSYSTEM_METADATA: Record<
  Exclude<SubsystemId, "auto">,
  { label: string; priority: number }
> = {
  pwsh: { label: "PowerShell 7", priority: 10 },
  powershell: { label: "Windows PowerShell", priority: 9 },
  "git-bash": { label: "Git Bash", priority: 7 },
  bash: { label: "Bash", priority: 6 },
  cmd: { label: "Command Prompt", priority: 5 },
  // WSL is deprioritized: it must be explicitly selected, never auto-chosen
  wsl: { label: "WSL", priority: 1 },
};

async function checkExecutable(name: string): Promise<string | undefined> {
  const isWindows = process.platform === "win32";
  const checkCmd = isWindows ? `where.exe ${name}` : `which ${name}`;
  try {
    const { stdout } = await execAsync(checkCmd);
    const path = stdout.split("\n")[0]?.trim();
    if (path && existsSync(path)) {
      return path;
    }
  } catch {
    // Not found in PATH
  }
  return undefined;
}

async function checkWsl(): Promise<{
  available: boolean;
  executable?: string;
  details?: string;
}> {
  const wslPath = await checkExecutable("wsl.exe");
  if (!wslPath) return { available: false };

  try {
    const { stdout } = await execAsync("wsl.exe --list --quiet", {
      timeout: 2000,
    });
    if (stdout.trim()) {
      return {
        available: true,
        executable: wslPath,
        details: "WSL is available with installed distributions",
      };
    }
  } catch (error) {
    debugLog(`WSL check failed: ${error}`);
  }
  return { available: false };
}

async function checkGitBash(): Promise<{
  available: boolean;
  executable?: string;
}> {
  const bashPath = await checkExecutable("bash.exe");
  if (bashPath && bashPath.toLowerCase().includes("git")) {
    return { available: true, executable: bashPath };
  }

  const commonPaths = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
  ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return { available: true, executable: path };
    }
  }

  return { available: false };
}

export async function discoverSubsystems(): Promise<SubsystemInfo[]> {
  const cacheKey = process.platform;
  const cached = discoveryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DISCOVERY_CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = (async () => {
    const isWindows = process.platform === "win32";
    const results: SubsystemInfo[] = [];

    results.push({
      id: "auto",
      label: "Auto (Recommended)",
      available: true,
      priority: 100,
      details: "Automatically chooses the best available subsystem",
    });

    if (!isWindows) {
      const bashPath = await checkExecutable("bash");
      results.push({
        id: "bash",
        label: "Bash",
        available: !!bashPath,
        executable: bashPath,
        priority: SUBSYSTEM_METADATA.bash.priority,
      });
      return results;
    }

    const [pwsh, powershell, cmd, wsl, gitBash, bash] = await Promise.all([
      checkExecutable("pwsh.exe"),
      checkExecutable("powershell.exe"),
      checkExecutable("cmd.exe"),
      checkWsl(),
      checkGitBash(),
      checkExecutable("bash.exe"),
    ]);

    results.push({
      id: "pwsh",
      label: SUBSYSTEM_METADATA.pwsh.label,
      available: !!pwsh,
      executable: pwsh,
      priority: SUBSYSTEM_METADATA.pwsh.priority,
    });

    results.push({
      id: "powershell",
      label: SUBSYSTEM_METADATA.powershell.label,
      available: !!powershell,
      executable: powershell,
      priority: SUBSYSTEM_METADATA.powershell.priority,
    });

    results.push({
      id: "wsl",
      label: SUBSYSTEM_METADATA.wsl.label,
      available: wsl.available,
      executable: wsl.executable,
      details: wsl.details,
      priority: SUBSYSTEM_METADATA.wsl.priority,
    });

    results.push({
      id: "git-bash",
      label: SUBSYSTEM_METADATA["git-bash"].label,
      available: gitBash.available,
      executable: gitBash.executable,
      priority: SUBSYSTEM_METADATA["git-bash"].priority,
    });

    results.push({
      id: "bash",
      label: SUBSYSTEM_METADATA.bash.label,
      available: !!bash,
      executable: bash,
      priority: SUBSYSTEM_METADATA.bash.priority,
    });

    results.push({
      id: "cmd",
      label: SUBSYSTEM_METADATA.cmd.label,
      available: !!cmd,
      executable: cmd,
      priority: SUBSYSTEM_METADATA.cmd.priority,
    });

    return results.sort((a, b) => b.priority - a.priority);
  })();

  discoveryCache.set(cacheKey, { timestamp: Date.now(), promise });
  promise.catch(() => {
    const current = discoveryCache.get(cacheKey);
    if (current?.promise === promise) {
      discoveryCache.delete(cacheKey);
    }
  });
  return promise;
}

export async function getEffectiveSubsystem(
  preferred?: string,
): Promise<SubsystemInfo> {
  const all = await discoverSubsystems();

  if (preferred && preferred !== "auto") {
    const chosen = all.find((s) => s.id === preferred);
    if (chosen && chosen.available) {
      return chosen;
    }
  }

  // On Windows, exclude WSL from auto-selection — it must be explicitly requested.
  const isWindows = process.platform === "win32";
  const available = all.filter(
    (s) => s.id !== "auto" && s.available && !(isWindows && s.id === "wsl"),
  );
  return (
    available[0] ||
    all.find((s) => s.id === "powershell") ||
    all.find((s) => s.id === "cmd") ||
    all[0]!
  );
}

export async function getSubsystemStatusSnapshot(
  preferred: string,
): Promise<SubsystemStatusSnapshot> {
  const all = await discoverSubsystems();
  const effective =
    preferred && preferred !== "auto"
      ? all.find((s) => s.id === preferred && s.available)
      : undefined;
  const fallbackOrder = all.filter((s) => s.id !== "auto");
  const available = fallbackOrder.filter((s) => s.available);
  const unavailable = fallbackOrder.filter((s) => !s.available);

  return {
    preferred,
    effective:
      effective ||
      available[0] ||
      all.find((s) => s.id === "powershell") ||
      all.find((s) => s.id === "cmd") ||
      all[0]!,
    available,
    unavailable,
    fallbackOrder,
    all,
  };
}

export function clearSubsystemDiscoveryCache(): void {
  discoveryCache.clear();
}

export async function buildSubsystemContextSummary(
  preferred: string,
): Promise<string> {
  const snapshot = await getSubsystemStatusSnapshot(preferred);
  const available = snapshot.available.map((s) => s.id);
  const unavailable = snapshot.unavailable.map((s) => s.id);
  const executableHints = snapshot.available
    .filter((item) => item.executable)
    .map((item) => `${item.id}=${item.executable}`)
    .slice(0, 4);

  return [
    "SHELL EXECUTION SUBSYSTEM",
    `- Preferred: ${snapshot.preferred}`,
    `- Effective for this turn: ${snapshot.effective.id} (${snapshot.effective.label})`,
    `- Available subsystems: ${available.join(", ")}`,
    unavailable.length > 0
      ? `- Unavailable subsystems: ${unavailable.join(", ")}`
      : "",
    `- Fallback order: ${snapshot.fallbackOrder.map((item) => item.id).join(" -> ")}`,
    executableHints.length > 0
      ? `- Executable hints: ${executableHints.join(" | ")}`
      : "",
    snapshot.effective.id === "wsl" ? "- Note: Commands will run inside WSL" : "",
    snapshot.effective.id === "powershell" || snapshot.effective.id === "pwsh"
      ? "- Note: Using PowerShell syntax (e.g. $env:VAR instead of $VAR)"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function isSubsystemQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [
    /\bwhat\s+is\s+(?:my|the)\s+subsystem\b/i,
    /\bquel\s+est\s+(?:mon|le)\s+subsystem\b/i,
    /\bwhat\s+shell\s+(?:are\s+you\s+using|is\s+active)\b/i,
    /\bquelle\s+shell\s+(?:utilises-tu|est\s+actif)\b/i,
    /\bwhich\s+shell\b/i,
    /\bwhich\s+shell\s+will\s+bash\s+use\b/i,
    /\bwhat\s+is\s+the\s+current\s+preferred\s+subsystem\b/i,
    /\bwhat\s+is\s+the\s+effective\s+subsystem\b/i,
    /\bwhat\s+is\s+the\s+fallback\s+order\b/i,
    /\bwhat\s+subsystems?\s+are\s+(?:installed|available)\b/i,
    /\bwhat\s+shell\s+subsystems?\s+are\s+(?:installed|available)\b/i,
    /\bam\s+i\s+on\s+(?:wsl|powershell|pwsh|cmd)\b/i,
    /\bsuis-je\s+sur\s+(?:wsl|powershell|pwsh|cmd)\b/i,
    /\bis\s+(?:wsl|pwsh|powershell|cmd|git bash|bash)\s+available\b/i,
    /\best-ce\s+que\s+(?:wsl|pwsh|powershell|cmd|git bash|bash)\s+est\s+disponible\b/i,
  ];
  return patterns.some((p) => p.test(lower));
}
