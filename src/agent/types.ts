import { CoreMessage, CoreTool, UserContent } from "ai";
import type { ReasoningEffort } from "../utils/config";
import type { GitWorkspaceState } from "./gitWorkspaceState";
import type { RepositorySummary } from "./repoScan";
import type { TaskModeDecision } from "./taskMode";

export type AgentEventType =
  | "text-delta"
  | "reasoning-start"
  | "reasoning-delta"
  | "reasoning-end"
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-input-end"
  | "tool-call-start"
  | "tool-call-end"
  | "tool-result"
  | "step-start"
  | "step-finish"
  | "fallback"
  | "finish"
  | "error";

export interface BaseEvent {
  type: AgentEventType;
}

export interface TextDeltaEvent extends BaseEvent {
  type: "text-delta";
  content: string;
}

export interface ReasoningStartEvent extends BaseEvent {
  type: "reasoning-start";
}

export interface ReasoningDeltaEvent extends BaseEvent {
  type: "reasoning-delta";
  content: string;
}

export interface ReasoningEndEvent extends BaseEvent {
  type: "reasoning-end";
}

export interface ToolInputStartEvent extends BaseEvent {
  type: "tool-input-start";
  toolCallId: string;
  toolName: string;
}

export interface ToolInputDeltaEvent extends BaseEvent {
  type: "tool-input-delta";
  toolCallId: string;
  delta: string;
}

export interface ToolInputEndEvent extends BaseEvent {
  type: "tool-input-end";
  toolCallId: string;
}

export interface ToolCallStartEvent extends BaseEvent {
  type: "tool-call-start";
  toolCallId: string;
  toolName: string;
}

export interface ToolCallEndEvent extends BaseEvent {
  type: "tool-call-end";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
}

export interface StepStartEvent extends BaseEvent {
  type: "step-start";
  stepNumber: number;
}

export interface StepFinishEvent extends BaseEvent {
  type: "step-finish";
  stepNumber: number;
  finishReason: string;
}

export interface FinishEvent extends BaseEvent {
  type: "finish";
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
    toolTokens?: number;
  };
}

export interface ErrorEvent extends BaseEvent {
  type: "error";
  error: string;
}

export interface FallbackEvent extends BaseEvent {
  type: "fallback";
  provider: string;
  model: string;
  reason: string;
}

export interface RunMetadata {
  configuredProvider: string;
  configuredModel: string;
  effectiveProvider: string;
  effectiveModel: string;
  authType?: "api_key" | "oauth" | "codestral-only";
  lightweightRoutingUsed: boolean;
  fallbackOccurred: boolean;
  routeReason?: string;
}

export type AgentEvent =
  | TextDeltaEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | ToolInputStartEvent
  | ToolInputDeltaEvent
  | ToolInputEndEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | ToolResultEvent
  | StepStartEvent
  | StepFinishEvent
  | FallbackEvent
  | FinishEvent
  | ErrorEvent;

export interface ProviderConfig {
  provider: string;
  model: string;
  modelReasoningEffort?: ReasoningEffort;
  apiKey?: string;
  auth?: ProviderAuth;
  authMode?: "generic" | "codestral-only";
  systemPrompt: string;
  tools?: Record<string, CoreTool>;
  maxSteps?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  isLightweight?: boolean;
}

export type ProviderAuth =
  | {
      type: "api_key";
      apiKey: string;
    }
  | {
      type: "oauth";
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      tokenType?: string;
      scope?: string;
    };

export interface AgentConfig {
  maxSteps?: number;
}

export interface AgentContext {
  messages: CoreMessage[];
  systemPrompt: string;
  tools: Record<string, CoreTool>;
  config: AgentConfig;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: CoreMessage["content"];
}

export interface ProviderSendOptions {
  abortSignal?: AbortSignal;
  alreadyCompacted?: boolean;
}

export interface AgentRuntimeContext {
  repoSummary?: RepositorySummary;
  gitWorkspaceState?: GitWorkspaceState;
  taskModeDecision?: TaskModeDecision;
  assistantCapabilitySummary?: string;
  environmentContextSummary?: string;
  subsystemContextSummary?: string;
  environmentHandlingMode?: "lightweight" | "full";
  contextMetrics?: {
    compiledContextChars: number;
    compactedContextSize: number;
    historyStrategy: "smart" | "lightweight_chat" | "assistant_capabilities";
  };
}

export interface Provider {
  sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions,
  ): AsyncGenerator<AgentEvent>;
}
