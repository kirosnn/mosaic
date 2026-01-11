import { VERSION } from './utils/version';

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  handler: (args?: string[]) => void;
}

export class CLI {
  private commands: Map<string, Command> = new Map();

  constructor() {
    this.addCommand({
      name: '--help',
      description: 'Show help message',
      aliases: ['-h'],
      handler: () => {
        this.showGlobalHelp();
      }
    });
  }

  addCommand(command: Command): void {
    this.commands.set(command.name, command);

    if (command.aliases) {
      command.aliases.forEach(alias => {
        this.commands.set(alias, command);
      });
    }
  }

  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  parseArgs(args: string[]): void {
    if (args.length === 0) {
      console.log('No command provided.');
      console.log('Use "mosaic --help" to see the help message.');
      return;
    }

    const commandName = args[0]!;
    const commandArgs = args.slice(1);

    const command = this.getCommand(commandName);
    if (command) {
      command.handler(commandArgs);
    } else {
      console.log(`Command "${commandName}" not found.`);
      console.log('Use "mosaic --help" to see the help message.');
    }
  }

  private showGlobalHelp(): void {
    console.log(`Mosaic CLI v${VERSION}`);
    console.log('An AI-powered CLI code assistant');
    console.log('');
    console.log('Usage:');
    console.log('  mosaic [options] [directory]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h      Show this help message');
    console.log('  --verbose, -v   Enable verbose mode (show detailed execution logs)');
    console.log('');
    console.log('Arguments:');
    console.log('  directory       Open Mosaic in the specified directory (optional)');
    console.log('');
    console.log('Examples:');
    console.log('  mosaic                    # Start Mosaic in current directory');
    console.log('  mosaic ./my-project       # Start Mosaic in my-project directory');
    console.log('  mosaic --verbose          # Start with verbose mode enabled');
    console.log('  mosaic -v ./my-project    # Start in my-project with verbose mode');
  }

}

export const cli = new CLI();