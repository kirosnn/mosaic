import type { Command, CommandResult } from './types';

export const compactCommand: Command = {
  name: 'compact',
  description: 'Compact the current conversation context',
  usage: '/compact [maxTokens]',
  execute: (args: string[]): CommandResult => {
    let maxTokens: number | undefined;
    if (args[0]) {
      const parsed = Number(args[0]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          success: false,
          content: 'Invalid maxTokens. Usage: /compact [maxTokens]',
          shouldAddToHistory: false
        };
      }
      maxTokens = Math.floor(parsed);
    }

    return {
      success: true,
      content: '',
      shouldAddToHistory: false,
      shouldCompactMessages: true,
      compactMaxTokens: maxTokens,
      shouldClearMessages: false
    };
  }
};
