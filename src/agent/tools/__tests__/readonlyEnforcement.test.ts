import { describe, expect, it, mock } from "bun:test";

mock.module("../../../utils/debug", () => ({ debugLog: () => {} }));
mock.module("../../../utils/sound", () => ({ playUiSound: () => {} }));
mock.module("../../../utils/pendingChangesBridge", () => ({
  addPendingChange: () => "mock-id",
  hasPendingChanges: () => false,
  isInReviewMode: () => false,
  startReview: async () => [],
  clearPendingChanges: () => {},
}));
mock.module("../../../utils/fileChangeTracker", () => ({
  trackFileChange: () => {},
  trackFileCreated: () => {},
}));
mock.module("../../../utils/approvalBridge", () => ({
  requestApproval: async () => ({ approved: false }),
}));
mock.module("../../../utils/config", () => ({
  shouldRequireApprovals: () => false,
  getPreferredSubsystem: () => "auto",
  readConfig: () => ({}),
}));
mock.module("../../subsystemDiscovery", () => ({
  discoverSubsystems: async () => [],
  getEffectiveSubsystem: async () => ({ id: "pwsh", label: "PowerShell 7", available: true, priority: 10 }),
}));
mock.module("../../../utils/localRules", () => ({
  getLocalBashDecision: () => null,
}));
mock.module("child_process", () => ({
  exec: (_cmd: string, _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "ok", stderr: "" });
  },
}));

import { executeTool } from "../executor";

describe("read-only enforcement", () => {
  it("blocks write tool in read-only mode", async () => {
    const result = await executeTool("write", { path: "test.txt", content: "" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("write");
    expect(result.error).toContain("read-only");
  });

  it("blocks delete tool in read-only mode", async () => {
    const result = await executeTool("delete", { path: "test.txt" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("blocks edit tool in read-only mode", async () => {
    const result = await executeTool("edit", { path: "test.txt", old_string: "a", new_string: "b" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("blocks mkdir tool in read-only mode", async () => {
    const result = await executeTool("mkdir", { path: "newdir" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("blocks rm command in read-only mode", async () => {
    const result = await executeTool("bash", { command: "rm test.txt" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("blocks Remove-Item command in read-only mode", async () => {
    const result = await executeTool("bash", { command: "Remove-Item test.txt" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("blocks git checkout in read-only mode", async () => {
    const result = await executeTool("bash", { command: "git checkout main" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("blocks git pull in read-only mode", async () => {
    const result = await executeTool("bash", { command: "git pull" }, { readOnlyMode: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("allows git status in read-only mode", async () => {
    const result = await executeTool("bash", { command: "git status --short --branch" }, { readOnlyMode: true });
    if (!result.success && result.error) {
      expect(result.error).not.toContain("read-only");
    }
  });

  it("allows grep arguments containing mutating words in read-only mode", async () => {
    const result = await executeTool("bash", { command: 'grep "rm" file.txt' }, { readOnlyMode: true });
    if (!result.success && result.error) {
      expect(result.error).not.toContain("read-only");
    }
  });

  it("allows rg arguments containing mutating words in read-only mode", async () => {
    const result = await executeTool("bash", { command: 'rg "touch" src' }, { readOnlyMode: true });
    if (!result.success && result.error) {
      expect(result.error).not.toContain("read-only");
    }
  });

  it("allows ls in read-only mode", async () => {
    const result = await executeTool("bash", { command: "ls" }, { readOnlyMode: true });
    if (!result.success && result.error) {
      expect(result.error).not.toContain("read-only");
    }
  });

  it("allows Get-ChildItem in read-only mode", async () => {
    const result = await executeTool("bash", { command: "Get-ChildItem" }, { readOnlyMode: true });
    if (!result.success && result.error) {
      expect(result.error).not.toContain("read-only");
    }
  });
});

describe("read-only enforcement disabled", () => {
  it("write tool is not blocked when not in read-only mode", async () => {
    const result = await executeTool("write", { path: "/nonexistent/path/that/fails.txt", content: "x" });
    if (!result.success && result.error) {
      expect(result.error).not.toContain("read-only");
    }
  });
});
