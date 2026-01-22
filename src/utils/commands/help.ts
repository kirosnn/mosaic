import type { Command } from './types';
import { commandRegistry } from './registry';

export const helpCommand: Command = {
  name: 'help',
  description: 'Show available commands',
  usage: '/help',
  aliases: ['h'],
  execute: (): { success: boolean; content: string } => {
    const commands = commandRegistry.getAll();
    const commandList = Array.from(commands.entries())
      .filter(([name, cmd]) => name === cmd.name)
      .map(([name, cmd]) => {
        const usage = cmd.usage ? ` - ${cmd.usage}` : '';
        const aliases = cmd.aliases && cmd.aliases.length > 0 ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
        return `/${name}${usage}${aliases}\n  ${cmd.description}`;
      })
      .join('\n\n');

    return {
      success: true,
      content: `Available commands:\n\n${commandList}`
    };
  }
};