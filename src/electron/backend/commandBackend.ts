import {
  commandRegistry,
  executeCommand,
  initializeCommands,
  parseCommand,
  type CommandExecutionContext,
} from "../../utils/commands";
import { listWorkspaceSkills } from "../../utils/skills";

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
}

interface CommandCatalogPayload {
  commands: CatalogCommand[];
  skills: CatalogSkill[];
}

interface ExecutePayload {
  input: string;
  context?: CommandExecutionContext;
}

interface BackendInput {
  workspaceRoot?: string;
  action?: "catalog" | "execute";
  execute?: ExecutePayload;
}

interface BackendOutput {
  ok: boolean;
  action: "catalog" | "execute";
  catalog?: CommandCatalogPayload;
  result?: SerializableCommandResult;
  error?: string;
}

function emit(payload: BackendOutput): void {
  process.stdout.write(JSON.stringify(payload));
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

function buildCatalog(): CommandCatalogPayload {
  const commandsByName = new Map<string, CatalogCommand>();
  const entries = commandRegistry.getAll();
  for (const [key, command] of entries) {
    if (key !== command.name) continue;
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
  };
}

async function run(): Promise<void> {
  initializeCommands();
  const raw = await readStdin();
  const input = (raw ? JSON.parse(raw) : {}) as BackendInput;
  const workspaceRoot = typeof input.workspaceRoot === "string" ? input.workspaceRoot : process.cwd();
  process.chdir(workspaceRoot);

  const action = input.action === "execute" ? "execute" : "catalog";
  if (action === "catalog") {
    emit({
      ok: true,
      action,
      catalog: buildCatalog(),
    });
    return;
  }

  const execute = input.execute;
  const commandInput = typeof execute?.input === "string" ? execute.input : "";
  if (!commandInput.trim()) {
    emit({
      ok: false,
      action,
      error: "Missing command input.",
    });
    return;
  }

  const result = await executeCommand(commandInput, execute?.context);
  emit({
    ok: true,
    action,
    result: normalizeResult(commandInput, result),
  });
}

try {
  await run();
} catch (error) {
  emit({
    ok: false,
    action: "execute",
    error: error instanceof Error ? error.message : "Unknown command backend error",
  });
}
