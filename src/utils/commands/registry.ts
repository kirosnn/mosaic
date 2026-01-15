import type { Command, CommandRegistry } from './types';

class CommandRegistryImpl implements CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getAll(): Map<string, Command> {
    return new Map(this.commands);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }
}

export const commandRegistry = new CommandRegistryImpl();