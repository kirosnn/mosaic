import { spawn } from "child_process";
import { SubsystemId, SubsystemInfo } from "../utils/subsystemDiscovery";
import { debugLog } from "../utils/debug";

export interface SubsystemResult {
  success: boolean;
  output: string;
  exitCode?: number;
  error?: string;
  subsystemUsed: SubsystemId;
  isCompatibilityFailure: boolean;
}

export interface SubsystemOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}

export function isCompatibilityFailure(
  error: string,
  subsystem: SubsystemId,
): boolean {
  const lower = error.toLowerCase();

  if (
    lower.includes("not recognized") ||
    lower.includes("not found") ||
    lower.includes("syntax error") ||
    lower.includes("invalid argument") ||
    lower.includes("enoent") ||
    lower.includes("cannot find the path")
  ) {
    return true;
  }

  if (
    subsystem === "wsl" &&
    (lower.includes("wsl.exe") || lower.includes("no distributions"))
  ) {
    return true;
  }

  if (subsystem === "powershell" || subsystem === "pwsh") {
    if (lower.includes("is not recognized as the name of a cmdlet")) {
      return true;
    }
  }

  return false;
}

export async function runCommand(
  subsystem: SubsystemInfo,
  command: string,
  options: SubsystemOptions = {},
): Promise<SubsystemResult> {
  const { cwd = process.cwd(), timeout = 30000, env = {}, abortSignal } = options;

  if (abortSignal?.aborted) {
    return {
      success: false,
      output: "",
      error: "Command aborted before execution",
      subsystemUsed: subsystem.id,
      isCompatibilityFailure: false,
    };
  }

  let executable = "";
  let args: string[] = [];

  switch (subsystem.id) {
    case "powershell":
      executable = "powershell.exe";
      args = ["-NoProfile", "-NonInteractive", "-Command", command];
      break;
    case "pwsh":
      executable = "pwsh.exe";
      args = ["-NoProfile", "-NonInteractive", "-Command", command];
      break;
    case "cmd":
      executable = "cmd.exe";
      args = ["/d", "/s", "/c", command];
      break;
    case "wsl":
      executable = "wsl.exe";
      args = ["-e", "sh", "-lc", command];
      break;
    case "git-bash":
      executable = subsystem.executable || "bash.exe";
      args = ["-lc", command];
      break;
    case "bash":
      executable = "bash";
      args = ["-lc", command];
      break;
    default:
      executable = process.platform === "win32" ? "powershell.exe" : "sh";
      args =
        process.platform === "win32" ? ["-Command", command] : ["-c", command];
  }

  debugLog(`[subsystem] spawning ${executable} ${args.join(" ")}`);

  return new Promise((resolve) => {
    const proc = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsVerbatimArguments: subsystem.id === "cmd",
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        output: stdout + stderr,
        error: `Command timed out after ${timeout}ms`,
        subsystemUsed: subsystem.id,
        isCompatibilityFailure: false,
      });
    }, timeout);

    const abortHandler = () => {
      clearTimeout(timer);
      proc.kill();
      resolve({
        success: false,
        output: stdout + stderr,
        error: "Command aborted by user",
        subsystemUsed: subsystem.id,
        isCompatibilityFailure: false,
      });
    };

    if (abortSignal) {
      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (abortSignal) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      const success = code === 0;
      const combinedOutput = (stdout + stderr).trim();

      resolve({
        success,
        output: combinedOutput,
        exitCode: code ?? undefined,
        error: success ? undefined : stderr.trim() || `Exit code ${code}`,
        subsystemUsed: subsystem.id,
        isCompatibilityFailure:
          !success &&
          isCompatibilityFailure(stderr || stdout || "", subsystem.id),
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (abortSignal) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      resolve({
        success: false,
        output: stdout + stderr,
        error: err.message,
        subsystemUsed: subsystem.id,
        isCompatibilityFailure: true,
      });
    });
  });
}
