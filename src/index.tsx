#!/usr/bin/env bun

const originalStderrWrite = process.stderr.write.bind(process.stderr);
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

process.stderr.write = ((chunk: any, ...args: any[]) => {
  const str = chunk.toString();
  if (str.includes('Cannot add child') ||
    str.includes('Aborted()') ||
    str.includes('Nodes with measure functions') ||
    str.includes('Maximum update depth')) {
    return true;
  }
  return originalStderrWrite(chunk, ...args);
}) as typeof process.stderr.write;

process.stdout.write = ((chunk: any, ...args: any[]) => {
  const str = chunk.toString();
  if (str.includes('Cannot add child') ||
    str.includes('Aborted()') ||
    str.includes('Nodes with measure functions')) {
    return true;
  }
  return originalStdoutWrite(chunk, ...args);
}) as typeof process.stdout.write;

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./components/App";
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

interface ParsedArgs {
  directory?: string;
  help?: boolean;
  initialMessage?: string;
  uninstall?: boolean;
  forceUninstall?: boolean;
  webServer?: boolean;
}

class CLI {
  parseArgs(args: string[]): ParsedArgs {
    const parsed: ParsedArgs = {};
    let i = 0;

    while (i < args.length) {
      const arg = args[i]!;

      if (arg === '--help' || arg === '-h') {
        parsed.help = true;
        i++;
      } else if (arg === '--directory' || arg === '-d') {
        parsed.directory = args[i + 1];
        i += 2;
      } else if (arg === 'run') {
        parsed.initialMessage = args[i + 1];
        i += 2;
      } else if (arg === 'uninstall') {
        parsed.uninstall = true;
        if (args[i + 1] === '--force') {
          parsed.forceUninstall = true;
          i += 2;
        } else {
          i++;
        }
      } else if (arg === 'web') {
        parsed.webServer = true;
        i++;
      } else if (!arg.startsWith('-')) {
        parsed.directory = arg;
        i++;
      } else {
        i++;
      }
    }

    return parsed;
  }

  showHelp(): void {
    const gold = (text: string) => `\x1b[38;2;255;202;56m${text}\x1b[0m`;

    console.log('');
    console.log(gold('███╗   ███╗'));
    console.log(gold('████╗ ████║'));
    console.log(gold('███╔████╔███║'));
    console.log(`
Mosaic - AI-powered coding agent

Usage:
  mosaic [options] [directory]

Options:
  -h, --help              Show this help message
  -d, --directory <path>  Open in specific directory
  run "<message>"         Launch with a message to execute
  web                     Start the web interface server
  uninstall [--force]     Uninstall Mosaic

Examples:
  mosaic                              Start in current directory
  mosaic ./my-project                 Start in specific directory
  mosaic run "fix the bug"            Launch with a task
  mosaic web                          Start web server on http://127.0.0.1:8192
  mosaic uninstall                    Interactive uninstall
  mosaic uninstall --force            Force uninstall (removes all data)
`);
  }

  async uninstall(force: boolean = false): Promise<void> {
    const { uninstallMosaic } = await import('./utils/uninstall');
    await uninstallMosaic(force);
  }
}

const cli = new CLI();
const args = process.argv.slice(2);
const parsed = cli.parseArgs(args);

if (parsed.help) {
  cli.showHelp();
  process.exit(0);
}

if (parsed.uninstall) {
  await cli.uninstall(parsed.forceUninstall);
  process.exit(0);
}

if (parsed.webServer) {
  const { spawn } = await import('child_process');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const { dirname } = await import('path');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const serverPath = path.join(__dirname, 'web', 'server.tsx');

  if (!existsSync(serverPath)) {
    console.error(`Error: Web server file not found at: ${serverPath}`);
    process.exit(1);
  }

  const serverProcess = spawn('bun', ['run', serverPath], {
    detached: false,
    stdio: 'inherit',
    env: {
      ...process.env,
      MOSAIC_PROJECT_PATH: process.cwd()
    }
  });

  serverProcess.on('error', (error) => {
    console.error(`Failed to start web server: ${error.message}`);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    serverProcess.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    serverProcess.kill();
    process.exit(0);
  });

  await new Promise(() => { });
}

if (parsed.directory) {
  const resolvedPath = resolve(parsed.directory);

  if (!existsSync(resolvedPath)) {
    console.error(`Error: Directory "${parsed.directory}" does not exist.`);
    process.exit(1);
  }

  if (!statSync(resolvedPath).isDirectory()) {
    console.error(`Error: "${parsed.directory}" is not a directory.`);
    process.exit(1);
  }

  process.chdir(resolvedPath);
}

import { addRecentProject } from './utils/config';
addRecentProject(process.cwd());

process.title = '⁘ Mosaic';

const cleanup = (code = 0) => {
  process.stdout.write('\x1b[?25h');
  process.exit(code);
};

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('uncaughtException', () => cleanup(1));
process.on('unhandledRejection', () => cleanup(1));

await new Promise(resolve => setTimeout(resolve, 100));

try {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App initialMessage={parsed.initialMessage} />);
} catch (error) {
  console.error(error);
  cleanup(1);
}