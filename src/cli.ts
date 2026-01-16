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
  run?: string;
}

export class CLI {
  parseArgs(args: string[]): ParsedArgs {
    const parsed: ParsedArgs = {
      help: false,
      uninstall: false,
      force: false,
    };

    const positionalArgs: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i]!;

      if (arg === '--help' || arg === '-h') {
        parsed.help = true;
        i++;
      } else if (arg === '--directory' || arg === '-d') {
        i++;
        if (i < args.length && !args[i]!.startsWith('-')) {
          parsed.directory = args[i];
          i++;
        }
      } else if (arg === '--force') {
        parsed.force = true;
        i++;
      } else if (arg === 'run') {
        i++;
        if (i < args.length) {
          parsed.run = args[i];
          i++;
        } else {
          console.log('Error: "run" command requires a message argument.');
          console.log('Usage: mosaic run "your message here"');
          process.exit(1);
        }
      } else if (!arg.startsWith('-')) {
        if (arg === 'uninstall') {
          parsed.uninstall = true;
        } else {
          positionalArgs.push(arg);
        }
        i++;
      } else {
        console.log(`Unknown option: ${arg}`);
        console.log('Use "mosaic --help" to see available options.');
        process.exit(1);
      }
    }

    if (positionalArgs.length > 0 && !parsed.run) {
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
    console.log('  mosaic run "<message>"');
    console.log('  mosaic uninstall [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h              Show this help message');
    console.log('  --directory, -d <path>  Open Mosaic in the specified directory');
    console.log('  --force                 Force uninstall without prompts (removes all data)');
    console.log('');
    console.log('Commands:');
    console.log('  run "<message>"         Launch Mosaic with a message to execute');
    console.log('  uninstall               Uninstall Mosaic and related files');
    console.log('');
    console.log('Arguments:');
    console.log('  directory               Open Mosaic in the specified directory (optional)');
    console.log('');
    console.log('Examples:');
    console.log('  mosaic                            # Start Mosaic in current directory');
    console.log('  mosaic ./my-project               # Start Mosaic in my-project directory');
    console.log('  mosaic run "fix the bug"          # Launch with a message to execute');
    console.log('  mosaic uninstall                  # Uninstall with interactive prompts');
    console.log('  mosaic uninstall --force          # Force uninstall (removes all data)');
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