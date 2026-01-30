import type { Command } from './types';

export const echoCommand: Command = {
  name: 'echo',
  description: 'Echo the provided text back to the user',
  usage: '/echo <text>',
  aliases: ['e'],
  execute: (args: string[], _fullCommand: string): { success: boolean; content: string } => {
    if (args.length === 0) {
      return {
        success: false,
        content: 'Error: /echo requires text to echo. Usage: /echo <text>'
      };
    }

    const text = args.join(' ');
    return {
      success: true,
      content: text
    };
  }
};