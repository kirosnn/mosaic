import { VERSION } from './utils/version';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

export interface ParsedArgs {
  help: boolean;
  directory?: string;
  uninstall: boolean;
  force: boolean;
}

export class CLI {
  parseArgs(args: string[]): ParsedArgs {
    const parsed: ParsedArgs = {
      help: false,
      uninstall: false,
      force: false,
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
      } else if (arg === '--force') {
        parsed.force = true;
      } else if (!arg.startsWith('-')) {
        if (arg === 'uninstall') {
          parsed.uninstall = true;
        } else {
          positionalArgs.push(arg);
        }
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
    console.log('  mosaic uninstall [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h              Show this help message');
    console.log('  --directory, -d <path>  Open Mosaic in the specified directory');
    console.log('  --force                 Force uninstall without prompts (removes all data)');
    console.log('');
    console.log('Arguments:');
    console.log('  directory               Open Mosaic in the specified directory (optional)');
    console.log('  uninstall               Uninstall Mosaic and related files');
    console.log('');
    console.log('Examples:');
    console.log('  mosaic                       # Start Mosaic in current directory');
    console.log('  mosaic ./my-project          # Start Mosaic in my-project directory');
    console.log('  mosaic uninstall             # Uninstall with interactive prompts');
    console.log('  mosaic uninstall --force     # Force uninstall (removes all data)');
    console.log('');
  }

  async uninstall(force: boolean): Promise<void> {
    console.log('⁘ Uninstalling Mosaic...');

    if (!force) {
      const keepHistory = await this.promptYesNo('Keep conversation history?');
      const keepConfig = await this.promptYesNo('Keep configuration files?');

      if (keepHistory && keepConfig) {
        console.log('Keeping all data. Only removing Mosaic installation.');
      } else if (keepHistory && !keepConfig) {
        console.log('Keeping history but removing configuration.');
      } else if (!keepHistory && keepConfig) {
        console.log('Keeping configuration but removing history.');
      } else {
        console.log('Removing all data.');
      }

      const mosaicDir = join(homedir(), '.mosaic');

      if (existsSync(mosaicDir)) {
        if (!keepConfig) {
          console.log('Removing configuration directory...');
          rmSync(mosaicDir, { recursive: true, force: true });
        } else {
          const configFile = join(mosaicDir, 'mosaic.jsonc');
          if (existsSync(configFile)) {
            console.log('Removing config file...');
            rmSync(configFile, { force: true });
          }

          if (!keepHistory) {
            const historyDir = join(mosaicDir, 'history');
            if (existsSync(historyDir)) {
              console.log('Removing history directory...');
              rmSync(historyDir, { recursive: true, force: true });
            }
          }
        }
      }
    } else {
      console.log('Force uninstall - removing all Mosaic data...');
      const mosaicDir = join(homedir(), '.mosaic');
      if (existsSync(mosaicDir)) {
        rmSync(mosaicDir, { recursive: true, force: true });
      }
    }

    console.log('Removing project-specific Mosaic files...');
    this.removeProjectFiles();

    console.log('Attempting to uninstall global Mosaic package...');
    try {
      const { execSync } = await import('child_process');
      execSync('bun unlink mosaic', { stdio: 'inherit' });
      console.log('• Global Mosaic package unlinked.');
    } catch (error) {
      console.log('• Could not unlink global package. You may need to run: bun unlink mosaic');
    }

    console.log('• Mosaic has been uninstalled successfully!');
    console.log('Thank you for using Mosaic! Bye.');
  }

  private async promptYesNo(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question(`${question} (y/N): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase().startsWith('y'));
      });
    });
  }

  private removeProjectFiles(): void {
    const findAndRemove = (rootDir: string, pattern: string, description: string) => {
      const findFiles = (dir: string): string[] => {
        const files: string[] = [];
        try {
          const items = readdirSync(dir);
          for (const item of items) {
            const fullPath = join(dir, item);
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              if (item === pattern.replace('**/', '')) {
                files.push(fullPath);
              } else {
                files.push(...findFiles(fullPath));
              }
            } else if (item === pattern.replace('**/', '')) {
              files.push(fullPath);
            }
          }
        } catch (error) {
        }
        return files;
      };

      const files = findFiles(rootDir);
      for (const file of files) {
        try {
          rmSync(file, { recursive: true, force: true });
          console.log(`Removed ${description}: ${file}`);
        } catch (error) {
          console.log(`Could not remove ${description}: ${file}`);
        }
      }
    };

    findAndRemove(process.cwd(), '.mosaic', '.mosaic directories');
    findAndRemove(process.cwd(), 'MOSAIC.md', 'MOSAIC.md files');
  }
}

export const cli = new CLI();