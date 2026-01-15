import { VERSION } from './utils/version';

export interface ParsedArgs {
  help: boolean;
  directory?: string;
}

export class CLI {
  parseArgs(args: string[]): ParsedArgs {
    const parsed: ParsedArgs = {
      help: false,
    };

    const positionalArgs: string[] = [];

    for (const arg of args) {
      if (arg === '--help' || arg === '-h') {
        parsed.help = true;
      } else if (arg === '--directory' || arg === '-d') {
        const nextIndex = args.indexOf(arg) + 1;
        if (nextIndex < args.length && !args[nextIndex]!.startsWith('-')) {
          parsed.directory = args[nextIndex];
          args.splice(nextIndex, 1);
        }
      } else if (!arg.startsWith('-')) {
        positionalArgs.push(arg);
      } else {
        console.log(`Unknown option: ${arg}`);
        console.log('Use "mosaic --help" to see available options.');
        process.exit(1);
      }
    }

    if (positionalArgs.length > 0) {
      parsed.directory = positionalArgs[0];
    }

    return parsed;
  }

  showHelp(): void {
    console.log('');
    console.log('███╗   ███╗');
    console.log('████╗ ████║');
    console.log('███╔████╔███║');
    console.log('');
    console.log(`Mosaic CLI v${VERSION}`);
    console.log('An AI-powered CLI code assistant');
    console.log('');
    console.log('Usage:');
    console.log('  mosaic [options] [directory]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h              Show this help message');
    console.log('  --directory, -d <path>  Open Mosaic in the specified directory');
    console.log('');
    console.log('Arguments:');
    console.log('  directory               Open Mosaic in the specified directory (optional)');
    console.log('');
    console.log('Examples:');
    console.log('  mosaic                       # Start Mosaic in current directory');
    console.log('  mosaic ./my-project          # Start Mosaic in my-project directory');
    console.log('');
  }
}

export const cli = new CLI();