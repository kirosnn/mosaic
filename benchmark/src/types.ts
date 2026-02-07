export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface LatencyMetrics {
  ttftMs: number;
  totalChars: number;
  streamDurationMs: number;
}

export interface CollectorResult {
  toolCalls: ToolCall[];
  textOutput: string;
  events: StreamEvent[];
  approvalRequests: ApprovalRequest[];
  questionRequests: QuestionRequest[];
  timedOut: boolean;
  error?: string;
  latency: LatencyMetrics;
}

export interface TestContext extends CollectorResult {
  benchSecret: string;
}

export interface ScoringRule {
  name: string;
  description: string;
  weight: number;
  isCritical: boolean;
  evaluate: (ctx: TestContext) => boolean;
}

export interface RuleResult {
  rule: string;
  description: string;
  passed: boolean;
  weight: number;
  isCritical: boolean;
  points: number;
}

export interface TestCase {
  id: string;
  suite: string;
  name: string;
  prompt: string;
  fixture: string;
  rules: ScoringRule[];
  approvalPolicy?: ApprovalPolicy;
  timeout?: number;
}

export interface PerformanceMetrics {
  ttftMs: number;
  charsPerSecond: number;
}

export interface TestResult {
  testId: string;
  suite: string;
  name: string;
  score: number;
  maxScore: number;
  percentage: number;
  ruleResults: RuleResult[];
  performance: PerformanceMetrics;
  duration: number;
  timedOut: boolean;
  error?: string;
}

export interface SuiteResult {
  suite: string;
  score: number;
  tests: TestResult[];
}

export interface BenchmarkReport {
  version: string;
  timestamp: string;
  provider: string;
  model: string;
  runs: number;
  suites: SuiteResult[];
  capability: number;
  reliability: number;
  overall: number;
  performance: PerformanceMetrics;
  duration: number;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export type ApprovalPolicy = "approve-all" | "deny-all" | "auto";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  preview: {
    title: string;
    content: string;
    details?: string[];
  };
  args: Record<string, unknown>;
}

export interface QuestionRequest {
  options: { label: string; description?: string }[];
  question: string;
}

export type StreamEvent =
  | { type: "ping" }
  | { type: "text-delta"; content: string }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; content: string }
  | { type: "reasoning-end" }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-input-end"; toolCallId: string }
  | { type: "tool-call-start"; toolCallId: string; toolName: string }
  | { type: "tool-call-end"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  | { type: "step-start"; stepNumber: number }
  | { type: "step-finish"; stepNumber: number; finishReason: string }
  | { type: "finish"; finishReason: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: "error"; error: string }
  | { type: "stopped"; message: string }
  | { type: "question"; request: QuestionRequest }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "title"; title: string }
  | { type: "explore-tool"; toolName: string };
