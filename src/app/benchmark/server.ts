import { createServer, type ServerResponse } from "http";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { Agent } from "../../agent";
import { buildAgentRuntimeContext } from "../../agent/runtimeContext";
import {
  buildAssistantCapabilitiesConversationHistoryResult,
  buildLightweightChatConversationHistoryResult,
  buildSmartConversationHistoryResult,
  type SmartContextMessage,
} from "../../agent/context";
import { isLightweightTaskMode } from "../../agent/taskMode";
import { beginOperationTurn } from "../../agent/deniedOperations";
import {
  readConfig,
  setActiveModel,
  setActiveProvider,
  setRequireApprovals,
} from "../../utils/config";
import { getDefaultContextBudget } from "../../utils/tokenEstimator";
import {
  getCurrentApproval,
  respondApproval,
  subscribeApproval,
} from "../../utils/approvalBridge";
import {
  answerQuestion,
  subscribeQuestion,
} from "../../utils/questionBridge";
import {
  getCurrentReviewChange,
  isInReviewMode,
  respondReview,
  subscribePendingChanges,
  subscribeReviewMode,
} from "../../utils/pendingChangesBridge";
import { initializeMcp, shutdownMcp } from "../../mcp";
import { BENCHMARK_SERVER_CONFIG } from "./config";

type IncomingMessage = {
  message?: string;
  history?: Array<{ role?: string; content?: string }>;
};

let activeAbortController: AbortController | null = null;
let activeResponse: ServerResponse | null = null;
let lastReviewId: string | null = null;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: import("http").IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  if (!body.trim()) return {};
  return JSON.parse(body) as Record<string, unknown>;
}

function writeEvent(event: unknown): void {
  if (!activeResponse || activeResponse.writableEnded) return;
  activeResponse.write(`${JSON.stringify(event)}\n`);
}

function emitCurrentReview(): void {
  if (!isInReviewMode()) return;
  const change = getCurrentReviewChange();
  if (!change || change.id === lastReviewId) return;
  lastReviewId = change.id;
  writeEvent({
    type: "approval",
    request: {
      id: change.id,
      toolName: change.source,
      preview: change.preview,
      args: { path: change.path },
    },
  });
}

async function buildConversation(messages: SmartContextMessage[]) {
  const config = readConfig();
  const runtimeContext = await buildAgentRuntimeContext(messages);
  const mode = runtimeContext.taskModeDecision?.mode;
  const lightweightEnvironment =
    mode === "environment_config" &&
    runtimeContext.environmentHandlingMode === "lightweight";
  const options = { messages, includeImages: false };
  const historyResult = mode === "assistant_capabilities"
    ? buildAssistantCapabilitiesConversationHistoryResult(options)
    : isLightweightTaskMode(mode) || lightweightEnvironment
      ? buildLightweightChatConversationHistoryResult(options)
      : buildSmartConversationHistoryResult({
          ...options,
          maxContextTokens:
            config.maxContextTokens ?? getDefaultContextBudget(config.provider),
          provider: config.provider,
          taskModeDecision: runtimeContext.taskModeDecision,
          repoSummary: runtimeContext.repoSummary,
          gitWorkspaceState: runtimeContext.gitWorkspaceState,
        });
  return { runtimeContext, history: historyResult.history };
}

async function streamMessage(payload: IncomingMessage, response: ServerResponse): Promise<void> {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    sendJson(response, 400, { error: "Message is required" });
    return;
  }

  const previous = Array.isArray(payload.history) ? payload.history : [];
  const messages: SmartContextMessage[] = previous
    .filter((entry) =>
      (entry.role === "user" || entry.role === "assistant") &&
      typeof entry.content === "string",
    )
    .map((entry) => ({
      role: entry.role as "user" | "assistant",
      content: entry.content as string,
    }));
  messages.push({ role: "user", content: message });

  beginOperationTurn();
  const built = await buildConversation(messages);
  const agent = new Agent(built.runtimeContext);
  const abortController = new AbortController();
  activeAbortController = abortController;
  activeResponse = response;
  lastReviewId = null;

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const unsubscribeApproval = subscribeApproval((request) => {
    if (request) writeEvent({ type: "approval", request });
  });
  const unsubscribeQuestion = subscribeQuestion((request) => {
    if (request) {
      writeEvent({
        type: "question",
        request: { question: request.prompt, options: request.options },
      });
    }
  });
  const unsubscribeReviewMode = subscribeReviewMode(() => emitCurrentReview());
  const unsubscribeChanges = subscribePendingChanges(() => emitCurrentReview());

  try {
    for await (const event of agent.streamMessages(built.history, {
      abortSignal: abortController.signal,
      alreadyCompacted: true,
    })) {
      writeEvent(event);
    }
  } catch (error) {
    writeEvent({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    unsubscribeApproval();
    unsubscribeQuestion();
    unsubscribeReviewMode();
    unsubscribeChanges();
    if (!response.writableEnded) response.end();
    activeAbortController = null;
    activeResponse = null;
    lastReviewId = null;
  }
}

export async function startBenchmarkServer(): Promise<void> {
  await initializeMcp().catch(() => {});
  const routes = BENCHMARK_SERVER_CONFIG.routes;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === routes.config) {
        const config = readConfig();
        sendJson(response, 200, {
          provider: config.provider,
          model: config.model,
          requireApprovals: config.requireApprovals !== false,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.config) {
        const body = await readJson(request);
        if (typeof body.provider === "string") setActiveProvider(body.provider);
        if (typeof body.model === "string") setActiveModel(body.model);
        const config = readConfig();
        sendJson(response, 200, { provider: config.provider, model: config.model });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.workspace) {
        const body = await readJson(request);
        const path = typeof body.path === "string" ? resolve(body.path) : "";
        if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
          sendJson(response, 400, { error: "Valid workspace path is required" });
          return;
        }
        process.chdir(path);
        process.env.MOSAIC_WORKSPACE = path;
        sendJson(response, 200, { path });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.approvals) {
        const body = await readJson(request);
        setRequireApprovals(body.requireApprovals === true);
        sendJson(response, 200, { requireApprovals: body.requireApprovals === true });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.approvalResponse) {
        const body = await readJson(request);
        const approved = body.approved === true;
        if (getCurrentApproval()) respondApproval(approved);
        else if (isInReviewMode()) respondReview(approved);
        sendJson(response, 200, { approved });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.questionAnswer) {
        const body = await readJson(request);
        answerQuestion(typeof body.index === "number" ? body.index : 0);
        sendJson(response, 200, { answered: true });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.stop) {
        activeAbortController?.abort();
        sendJson(response, 200, { stopped: true });
        return;
      }
      if (request.method === "POST" && url.pathname === routes.message) {
        const body = await readJson(request) as IncomingMessage;
        await streamMessage(body, response);
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else if (!response.writableEnded) {
        writeEvent({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        response.end();
      }
    }
  });

  let port = BENCHMARK_SERVER_CONFIG.portStart;
  while (port <= BENCHMARK_SERVER_CONFIG.portEnd) {
    try {
      await new Promise<void>((resolveListen, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, BENCHMARK_SERVER_CONFIG.host);
      });
      break;
    } catch {
      port++;
    }
  }
  if (port > BENCHMARK_SERVER_CONFIG.portEnd) {
    throw new Error(
      `No benchmark port available from ${BENCHMARK_SERVER_CONFIG.portStart} to ${BENCHMARK_SERVER_CONFIG.portEnd}`,
    );
  }

  console.log(`Mosaic benchmark server listening on http://${BENCHMARK_SERVER_CONFIG.host}:${port}`);
  const shutdown = async () => {
    activeAbortController?.abort();
    await shutdownMcp().catch(() => {});
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
