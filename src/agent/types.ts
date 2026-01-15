import { CoreMessage, CoreTool } from 'ai';

export type AgentEventType =
  | 'text-delta'
  | 'reasoning-start'
  | 'reasoning-delta'
  | 'reasoning-end'
  | 'tool-input-start'
  | 'tool-input-delta'
  | 'tool-input-end'
  | 'tool-call-start'
  | 'tool-call-end'
  | 'tool-result'
  | 'step-start'
  | 'step-finish'
  | 'finish'
  | 'error';

export interface BaseEvent {
  type: AgentEventType;
}

export interface TextDeltaEvent extends BaseEvent {
  type: 'text-delta';
  content: string;
}

export interface ReasoningStartEvent extends BaseEvent {
  type: 'reasoning-start';
}

export interface ReasoningDeltaEvent extends BaseEvent {
  type: 'reasoning-delta';
  content: string;
}

export interface ReasoningEndEvent extends BaseEvent {
  type: 'reasoning-end';
}

export interface ToolInputStartEvent extends BaseEvent {
  type: 'tool-input-start';
  toolCallId: string;
  toolName: string;
}

export interface ToolInputDeltaEvent extends BaseEvent {
  type: 'tool-input-delta';
  toolCallId: string;
  delta: string;
}

export interface ToolInputEndEvent extends BaseEvent {
  type: 'tool-input-end';
  toolCallId: string;
}

export interface ToolCallStartEvent extends BaseEvent {
  type: 'tool-call-start';
  toolCallId: string;
  toolName: string;
}

export interface ToolCallEndEvent extends BaseEvent {
  type: 'tool-call-end';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseEvent {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
}

export interface StepStartEvent extends BaseEvent {
  type: 'step-start';
  stepNumber: number;
}

export interface StepFinishEvent extends BaseEvent {
  type: 'step-finish';
  stepNumber: number;
  finishReason: string;
}

export interface FinishEvent extends BaseEvent {
  type: 'finish';
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  error: string;
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
  | FinishEvent
  | ErrorEvent;

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  systemPrompt: string;
  tools?: Record<string, CoreTool>;
  maxSteps?: number;
}

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
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderSendOptions {
  abortSignal?: AbortSignal;
}

export interface Provider {
  sendMessage(
    messages: CoreMessage[],
    config: ProviderConfig,
    options?: ProviderSendOptions
  ): AsyncGenerator<AgentEvent>;
}