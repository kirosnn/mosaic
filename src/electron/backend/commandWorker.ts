import readline from "node:readline";
import {
  commandRegistry,
  executeCommand,
  initializeCommands,
  parseCommand,
  type CommandExecutionContext,
} from "../../utils/commands";
import { listWorkspaceSkills } from "../../utils/skills";
import type { UsageReport } from "../../utils/usage";

interface CatalogCommand {
  name: string;
  description: string;
  usage?: string;
  aliases: string[];
}

interface CatalogSkill {
  id: string;
  title: string;
  description: string;
}

interface SerializableCommandResult {
  success: boolean;
  content: string;
  shouldAddToHistory?: boolean;
  shouldClearMessages?: boolean;
  shouldCompactMessages?: boolean;
  compactMaxTokens?: number;
  errorBanner?: string;
  openUsageView?: boolean;
  usageReport?: UsageReport;
}

interface CommandCatalogPayload {
  commands: CatalogCommand[];
  skills: CatalogSkill[];
}

interface ExecutePayload {
  input: string;
  context?: CommandExecutionContext;
}

interface WorkerRequest {
  requestId?: string;
  workspaceRoot?: string;
  action?: "catalog" | "execute";
  execute?: ExecutePayload;
}

interface WorkerResponse {
  requestId: string;
  ok: boolean;
  action: "catalog" | "execute";
  catalog?: CommandCatalogPayload;
  result?: SerializableCommandResult;
  error?: string;
}

const DISABLED_COMMANDS = new Set(["usage"]);

function emit(payload: WorkerResponse): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function getResolvedCommandName(input: string): string {
  const parsed = parseCommand(input);
  if (!parsed) return "";
  const command = commandRegistry.get(parsed.command);
  if (command?.name) {
    return command.name.toLowerCase();
  }
  return parsed.command.toLowerCase();
}

function buildDisabledCommandResult(commandName: string): SerializableCommandResult {
  return {
    success: false,
    content: `Command /${commandName} is not available in Electron mode.`,
    shouldAddToHistory: false,
  };
}

function buildCatalog(): CommandCatalogPayload {
  const commandsByName = new Map<string, CatalogCommand>();
  const entries = commandRegistry.getAll();
  for (const [key, command] of entries) {
    if (key !== command.name) continue;
    if (DISABLED_COMMANDS.has(command.name.toLowerCase())) continue;
    commandsByName.set(command.name, {
      name: command.name,
      description: command.description,
      usage: command.usage,
      aliases: Array.isArray(command.aliases) ? [...command.aliases] : [],
    });
  }

  const skills = listWorkspaceSkills().map((skill) => ({
    id: skill.id,
    title: skill.title,
    description: skill.summary || skill.description || "",
  }));

  return {
    commands: Array.from(commandsByName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    skills: skills.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function formatSelectMenuAsText(input: string, options: Array<{
  name: string;
  description: string;
  value: string;
  active?: boolean;
  disabled?: boolean;
}>): string {
  const parsed = parseCommand(input);
  const root = parsed?.command || "command";
  const lines = options.map((option) => {
    const parts: string[] = [option.value];
    if (option.description) {
      parts.push(option.description);
    }
    if (option.active) {
      parts.push("current");
    }
    if (option.disabled) {
      parts.push("unavailable");
    }
    return `- ${parts.join(" | ")}`;
  });
  lines.push(`Run /${root} <value> to select.`);
  return lines.join("\n");
}

function normalizeResult(input: string, result: Awaited<ReturnType<typeof executeCommand>>): SerializableCommandResult {
  if (!result) {
    return {
      success: false,
      content: "Invalid command.",
      shouldAddToHistory: false,
    };
  }

  if (result.showSelectMenu) {
    return {
      success: result.success,
      content: formatSelectMenuAsText(input, result.showSelectMenu.options),
      shouldAddToHistory: false,
      shouldClearMessages: false,
      shouldCompactMessages: false,
      compactMaxTokens: result.compactMaxTokens,
      errorBanner: result.errorBanner,
      openUsageView: result.openUsageView,
      usageReport: result.usageReport,
    };
  }

  if (result.shouldCompactMessages) {
    return {
      success: true,
      content: "Context compaction is not available in Electron mode yet.",
      shouldAddToHistory: false,
      shouldClearMessages: false,
      shouldCompactMessages: false,
      compactMaxTokens: result.compactMaxTokens,
      errorBanner: result.errorBanner,
      openUsageView: result.openUsageView,
      usageReport: result.usageReport,
    };
  }

  return {
    success: result.success,
    content: result.content,
    shouldAddToHistory: result.shouldAddToHistory,
    shouldClearMessages: result.shouldClearMessages,
    shouldCompactMessages: result.shouldCompactMessages,
    compactMaxTokens: result.compactMaxTokens,
    errorBanner: result.errorBanner,
    openUsageView: result.openUsageView,
    usageReport: result.usageReport,
  };
}

function normalizeWorkspaceRoot(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value ? value : null;
}

function normalizeRequestId(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  const requestId = normalizeRequestId(request.requestId);
  const action: "catalog" | "execute" = request.action === "execute" ? "execute" : "catalog";
  const workspace = normalizeWorkspaceRoot(request.workspaceRoot);
  if (workspace) {
    process.chdir(workspace);
  }

  if (action === "catalog") {
    return {
      requestId,
      ok: true,
      action,
      catalog: buildCatalog(),
    };
  }

  const commandInput = typeof request.execute?.input === "string" ? request.execute.input : "";
  if (!commandInput.trim()) {
    return {
      requestId,
      ok: false,
      action,
      error: "Missing command input.",
    };
  }

  const commandName = getResolvedCommandName(commandInput);
  if (commandName && DISABLED_COMMANDS.has(commandName)) {
    return {
      requestId,
      ok: true,
      action,
      result: buildDisabledCommandResult(commandName),
    };
  }

  const result = await executeCommand(commandInput, request.execute?.context);
  return {
    requestId,
    ok: true,
    action,
    result: normalizeResult(commandInput, result),
  };
}

async function run(): Promise<void> {
  initializeCommands();

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const rawLine = typeof line === "string" ? line.trim() : "";
    if (!rawLine) continue;

    let parsed: WorkerRequest;
    try {
      parsed = JSON.parse(rawLine) as WorkerRequest;
    } catch {
      emit({
        requestId: "",
        ok: false,
        action: "catalog",
        error: "Invalid JSON request.",
      });
      continue;
    }

    try {
      const response = await handleRequest(parsed);
      emit(response);
    } catch (error) {
      emit({
        requestId: normalizeRequestId(parsed.requestId),
        ok: false,
        action: parsed.action === "execute" ? "execute" : "catalog",
        error: error instanceof Error ? error.message : "Unknown command backend error",
      });
    }
  }
}

void run();
