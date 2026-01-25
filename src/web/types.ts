export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    displayContent?: string;
    isError?: boolean;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    success?: boolean;
    timestamp?: number;
    thinkingContent?: string;
    isRunning?: boolean;
    runningStartTime?: number;
    responseDuration?: number;
    blendWord?: string;
}