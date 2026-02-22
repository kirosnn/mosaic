import type { ImageAttachment } from '../images';

export interface SelectOption {
  name: string;
  description: string;
  value: string;
  active?: boolean;
  disabled?: boolean;
  category?: string;
  badge?: string;
}

export interface CommandResult {
  success: boolean;
  content: string;
  shouldAddToHistory?: boolean;
  shouldClearMessages?: boolean;
  shouldCompactMessages?: boolean;
  compactMaxTokens?: number;
  showSelectMenu?: {
    title: string;
    options: SelectOption[];
    onSelect: (value: string) => void;
  };
  errorBanner?: string;
}

export interface CommandTokenBreakdown {
  prompt: number;
  reasoning: number;
  output: number;
  tools: number;
}

export interface CommandContextMessage {
  role: "user" | "assistant" | "tool" | "slash";
  content: string;
  thinkingContent?: string;
  images?: ImageAttachment[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
}

export interface CommandExecutionContext {
  messages?: CommandContextMessage[];
  imagesSupported?: boolean;
  currentTokens?: number;
  tokenBreakdown?: CommandTokenBreakdown;
  lastPromptTokens?: number;
  isProcessing?: boolean;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  execute: (args: string[], fullCommand: string, context?: CommandExecutionContext) => Promise<CommandResult> | CommandResult;
}

export interface CommandRegistry {
  register: (command: Command) => void;
  get: (name: string) => Command | undefined;
  getAll: () => Map<string, Command>;
  has: (name: string) => boolean;
}
