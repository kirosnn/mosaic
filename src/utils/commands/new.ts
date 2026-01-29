import type { Command, CommandResult } from './types';

export const newCommand: Command = {
  name: 'new',
  description: 'Start a new chat',
  usage: '/new',
  aliases: ['clear'],
  execute: (args: string[], fullCommand: string): CommandResult => {
    return {
      success: true,
      content: 'Starting a new chat...',
      shouldClearMessages: true
    };
  }
};