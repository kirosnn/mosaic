import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { executeTool } from "../executor";
import * as child_process from "child_process";

mock.module("child_process", () => ({
  exec: (cmd: string, options: any, callback: any) => {
    if (cmd.includes("powershell.exe")) {
      if (cmd.includes("fail-pwsh")) {
        callback(new Error("pwsh failed"), {
          stdout: "",
          stderr: "pwsh failed",
        });
      } else {
        callback(null, { stdout: "powershell output", stderr: "" });
      }
    } else if (cmd.includes("cmd.exe")) {
      callback(null, { stdout: "cmd output", stderr: "" });
    } else if (cmd.includes("wsl.exe")) {
      callback(null, { stdout: "wsl output", stderr: "" });
    } else {
      callback(null, { stdout: "default output", stderr: "" });
    }
  },
}));

mock.module("../../utils/subsystemDiscovery", () => ({
  discoverSubsystems: async () => [
    { id: "auto", label: "Auto", available: true, priority: 100 },
    { id: "pwsh", label: "PowerShell 7", available: true, priority: 10 },
    {
      id: "powershell",
      label: "Windows PowerShell",
      available: true,
      priority: 9,
    },
    { id: "cmd", label: "Command Prompt", available: true, priority: 5 },
  ],
  getEffectiveSubsystem: async (preferred: string) => {
    if (preferred === "pwsh")
      return {
        id: "pwsh",
        label: "PowerShell 7",
        available: true,
        priority: 10,
      };
    return { id: "pwsh", label: "PowerShell 7", available: true, priority: 10 };
  },
}));

describe("executor bash subsystem", () => {
  it("should execute command with the effective subsystem", async () => {
    const result = await executeTool(
      "bash",
      { command: "echo hello" },
      { workspace: process.cwd(), skipApproval: true },
    );
    expect(result.success).toBe(true);
  });

  it("should include fallback information in result when retry happens", async () => {});
});
