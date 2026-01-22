import type { CommandResult } from './types';
import { commandRegistry } from './registry';
import { echoCommand } from './echo';
import { helpCommand } from './help';
import { initCommand } from './init';
import { undoCommand } from './undo';
import { redoCommand } from './redo';
import { sessionsCommand } from './sessions';
import { webCommand } from './web';

export { commandRegistry } from './registry';
export type { Command, CommandResult, CommandRegistry } from './types';

export function isCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

export function parseCommand(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  const parts = withoutSlash.split(/\s+/);
  const command = parts[0]!.toLowerCase();
  const args = parts.slice(1);

  return { command, args };
}

export async function executeCommand(input: string): Promise<CommandResult | null> {
  const parsed = parseCommand(input);
  if (!parsed) {
    return null;
  }

  const { command, args } = parsed;
  const cmd = commandRegistry.get(command);

  if (!cmd) {
    return {
      success: false,
      content: `Unknown command: /${command}. Type /help for available commands.`,
      shouldAddToHistory: false
    };
  }

  try {
    return await cmd.execute(args, input);
  } catch (error) {
    return {
      success: false,
      content: `Error executing command /${command}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      shouldAddToHistory: false
    };
  }
}

export function initializeCommands(): void {
  commandRegistry.register(echoCommand);
  commandRegistry.register(helpCommand);
  commandRegistry.register(initCommand);
  commandRegistry.register(undoCommand);
  commandRegistry.register(redoCommand);
  commandRegistry.register(sessionsCommand);
  commandRegistry.register(webCommand);
}