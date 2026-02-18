import type { Command } from './types';
import { commandRegistry } from './registry';
import { listWorkspaceSkills } from '../skills';

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

    const skills = listWorkspaceSkills();
    const skillHint = skills.length > 0
      ? `\n\nSkill shortcuts:\n- Skills are auto-enabled by default.\n- Force one with /<skill-id> <instructions>\n- Examples: ${skills.slice(0, 3).map((skill) => `/${skill.id}`).join(', ')}`
      : '';

    return {
      success: true,
      content: `Available commands:\n\n${commandList}${skillHint}`
    };
  }
};
