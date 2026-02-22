import { Agent, type AgentMessage } from "../../agent";
import { buildSmartConversationHistory, type SmartContextMessage } from "../../agent/context";
import { readConfig } from "../../utils/config";

interface InputMessage {
  role: "user" | "assistant" | "tool" | "slash";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
}

interface BackendPayload {
  workspaceRoot?: string;
  messages?: InputMessage[];
}

function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
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

function normalizeMessages(inputMessages: InputMessage[] | undefined): SmartContextMessage[] {
  if (!Array.isArray(inputMessages)) return [];
  const normalized: SmartContextMessage[] = [];
  for (const message of inputMessages) {
    if (!message || typeof message.content !== "string") continue;
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool" && message.role !== "slash") {
      continue;
    }
    normalized.push({
      role: message.role,
      content: message.content,
      toolName: message.toolName,
      toolArgs: message.toolArgs,
      toolResult: message.toolResult,
      success: message.success,
    });
  }
  return normalized;
}

async function run(): Promise<void> {
  let configProvider: string | undefined;
  let configModel: string | undefined;
  try {
    const rawInput = await readStdin();
    const payload = (rawInput ? JSON.parse(rawInput) : {}) as BackendPayload;
    const workspaceRoot = typeof payload.workspaceRoot === "string" ? payload.workspaceRoot : process.cwd();
    process.chdir(workspaceRoot);
    const config = readConfig();
    configProvider = config.provider;
    configModel = config.model;

    const providerStatus = await Agent.ensureProviderReady();
    if (!providerStatus.ready) {
      emit({
        type: "error",
        source: "provider",
        provider: configProvider,
        model: configModel,
        error: providerStatus.error ?? "Provider is not ready",
      });
      emit({ type: "done" });
      return;
    }

    const normalized = normalizeMessages(payload.messages);
    const history = buildSmartConversationHistory({
      messages: normalized,
      includeImages: false,
      maxContextTokens: config.maxContextTokens,
      provider: config.provider,
    });
    const streamInput: AgentMessage[] = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const agent = new Agent();
    for await (const event of agent.streamMessages(streamInput, { alreadyCompacted: true })) {
      if (event.type === "error") {
        emit({
          type: "event",
          event: {
            ...event,
            source: "provider",
            provider: configProvider,
            model: configModel,
          },
        });
      } else {
        emit({ type: "event", event });
      }
    }

    emit({ type: "done" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backend error";
    emit({
      type: "error",
      source: "backend",
      provider: configProvider,
      model: configModel,
      error: message,
    });
    emit({ type: "done" });
  }
}

await run();
