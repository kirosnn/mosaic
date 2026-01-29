export interface CommandResult {
  success: boolean;
  content: string;
  shouldAddToHistory?: boolean;
  shouldClearMessages?: boolean;
  shouldCompactMessages?: boolean;
  compactMaxTokens?: number;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  execute: (args: string[], fullCommand: string) => Promise<CommandResult> | CommandResult;
}

export interface CommandRegistry {
  register: (command: Command) => void;
  get: (name: string) => Command | undefined;
  getAll: () => Map<string, Command>;
  has: (name: string) => boolean;
}