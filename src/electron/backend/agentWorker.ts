import readline from "node:readline";
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

interface WorkerRequest {
  requestId?: string;
  action?: "start" | "cancel";
  workspaceRoot?: string;
  messages?: InputMessage[];
  chatRequestId?: string;
}

interface WorkerResponse {
  kind: "response";
  requestId: string;
  action: "start" | "cancel";
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

interface WorkerChatEvent {
  kind: "chat-event";
  requestId: string;
  payload: {
    type: "event" | "error" | "done";
    event?: unknown;
    error?: string;
    source?: string;
    provider?: string;
    model?: string;
    cancelled?: boolean;
  };
}

type WorkerOutput = WorkerResponse | WorkerChatEvent;

interface ActiveRun {
  requestId: string;
  cancelled: boolean;
  abortController: AbortController;
}

let activeRun: ActiveRun | null = null;

function emit(payload: WorkerOutput): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitResponse(payload: WorkerResponse): void {
  emit(payload);
}

function emitChatEvent(requestId: string, payload: WorkerChatEvent["payload"]): void {
  emit({
    kind: "chat-event",
    requestId,
    payload,
  });
}

function normalizeRequestId(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

function normalizeWorkspaceRoot(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value ? value : null;
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

async function runChat(active: ActiveRun, request: WorkerRequest): Promise<void> {
  let configProvider: string | undefined;
  let configModel: string | undefined;

  try {
    const workspaceRoot = normalizeWorkspaceRoot(request.workspaceRoot);
    if (workspaceRoot) {
      process.chdir(workspaceRoot);
    }

    const config = readConfig();
    configProvider = config.provider;
    configModel = config.model;

    const providerStatus = await Agent.ensureProviderReady();
    if (!providerStatus.ready) {
      emitChatEvent(active.requestId, {
        type: "error",
        source: "provider",
        provider: configProvider,
        model: configModel,
        error: providerStatus.error ?? "Provider is not ready",
      });
      return;
    }

    const normalized = normalizeMessages(request.messages);
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
    for await (const event of agent.streamMessages(streamInput, {
      alreadyCompacted: true,
      abortSignal: active.abortController.signal,
    })) {
      if (active.cancelled) {
        break;
      }

      if (event.type === "error") {
        emitChatEvent(active.requestId, {
          type: "event",
          event: {
            ...event,
            source: "provider",
            provider: configProvider,
            model: configModel,
          },
        });
      } else {
        emitChatEvent(active.requestId, {
          type: "event",
          event,
        });
      }
    }
  } catch (error) {
    if (!active.cancelled) {
      emitChatEvent(active.requestId, {
        type: "error",
        source: "backend",
        provider: configProvider,
        model: configModel,
        error: error instanceof Error ? error.message : "Unknown backend error",
      });
    }
  } finally {
    emitChatEvent(active.requestId, {
      type: "done",
      cancelled: active.cancelled,
    });
    if (activeRun && activeRun.requestId === active.requestId) {
      activeRun = null;
    }
  }
}

function handleStartRequest(request: WorkerRequest): void {
  const requestId = normalizeRequestId(request.requestId);
  if (!requestId) {
    emitResponse({
      kind: "response",
      requestId,
      action: "start",
      ok: false,
      error: "Missing request id.",
    });
    return;
  }

  if (activeRun) {
    emitResponse({
      kind: "response",
      requestId,
      action: "start",
      ok: false,
      error: "A chat request is already running.",
    });
    return;
  }

  const nextRun: ActiveRun = {
    requestId,
    cancelled: false,
    abortController: new AbortController(),
  };

  activeRun = nextRun;
  emitResponse({
    kind: "response",
    requestId,
    action: "start",
    ok: true,
  });

  void runChat(nextRun, request);
}

function handleCancelRequest(request: WorkerRequest): void {
  const requestId = normalizeRequestId(request.requestId);
  const targetRequestId = normalizeRequestId(request.chatRequestId);
  if (!requestId) {
    emitResponse({
      kind: "response",
      requestId,
      action: "cancel",
      ok: false,
      error: "Missing request id.",
    });
    return;
  }

  if (!activeRun) {
    emitResponse({
      kind: "response",
      requestId,
      action: "cancel",
      ok: true,
      cancelled: false,
    });
    return;
  }

  if (targetRequestId && activeRun.requestId !== targetRequestId) {
    emitResponse({
      kind: "response",
      requestId,
      action: "cancel",
      ok: true,
      cancelled: false,
    });
    return;
  }

  activeRun.cancelled = true;
  activeRun.abortController.abort();

  emitResponse({
    kind: "response",
    requestId,
    action: "cancel",
    ok: true,
    cancelled: true,
  });
}

async function run(): Promise<void> {
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
      emitResponse({
        kind: "response",
        requestId: "",
        action: "start",
        ok: false,
        error: "Invalid JSON request.",
      });
      continue;
    }

    if (parsed.action === "cancel") {
      handleCancelRequest(parsed);
      continue;
    }

    handleStartRequest(parsed);
  }
}

void run();
