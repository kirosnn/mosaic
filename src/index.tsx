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
  mcpCommand?: boolean;
  mcpArgs?: string[];
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
        const message = args.slice(i + 1).join(' ');
        if (message) parsed.initialMessage = message;
        i = args.length;
      } else if (arg === 'uninstall') {
        parsed.uninstall = true;
        if (args[i + 1] === '--force') {
          parsed.forceUninstall = true;
          i += 2;
        } else {
          i++;
        }
      } else if (arg === 'mcp') {
        parsed.mcpCommand = true;
        parsed.mcpArgs = args.slice(i + 1);
        i = args.length;
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
    const gray = (text: string) => `\x1b[90m${text}\x1b[0m`;

    console.log('');
    console.log(`
${gold('Mosaic')}

${gold('Usage')}
  $ mosaic [options] [path]
  $ mosaic <command> [options]

${gold('Options')}
  -h, --help                ${gray('Show this help message')}
  -d, --directory <path>    ${gray('Open Mosaic in a specific directory (default: current)')}

${gold('Commands')}
  run "<message>"           ${gray('Launch Mosaic with an initial prompt to execute immediately')}
  web                       ${gray('Start the Mosaic web interface server (default: http://127.0.0.1:8192)')}
  mcp <subcommand>          ${gray('Manage Model Context Protocol (MCP) servers')}
  uninstall [--force]       ${gray('Uninstall Mosaic from your system')}

${gold('MCP Subcommands')}
  mosaic mcp list           ${gray('List configured MCP servers')}
  mosaic mcp add [name]     ${gray('Add a new MCP server')}
  mosaic mcp doctor         ${gray('Run diagnostics')}
  mosaic mcp help           ${gray('View full list of MCP commands')}

${gold('Examples')}
  ${gray('mosaic')}                              # Start in current directory
  ${gray('mosaic ./my-project')}                 # Start in specific directory
  ${gray('mosaic run "Fix the bug in main.ts"')} # Launch with a specific task
  ${gray('mosaic web')}                          # Start the web UI
  ${gray('mosaic mcp list')}                     # Check connected tools
  ${gray('mosaic uninstall --force')}            # Completely remove Mosaic
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

if (parsed.mcpCommand) {
  const { runMcpCli } = await import('./mcp/cli/index');
  await runMcpCli(parsed.mcpArgs ?? []);
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
import { appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEBUG_LOG = join(homedir(), '.mosaic', 'debug.log');
const debugLog = (msg: string) => {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
};

debugLog('--- Mosaic starting ---');
addRecentProject(process.cwd());

debugLog('MCP init...');
const { initializeMcp } = await import('./mcp/index');
await initializeMcp().catch((e) => { debugLog(`MCP init error: ${e}`); });
debugLog('MCP init done');

process.title = '⁘ Mosaic';

const cleanup = async (code = 0) => {
  debugLog(`cleanup called with code=${code}`);
  try {
    const { shutdownMcp } = await import('./mcp/index');
    await shutdownMcp();
  } catch { }
  process.stdout.write('\x1b[?25h');
  process.exit(code);
};

process.on('SIGINT', () => { debugLog('SIGINT received'); cleanup(0); });
process.on('SIGTERM', () => { debugLog('SIGTERM received'); cleanup(0); });
process.on('uncaughtException', (err) => {
  const msg = `Uncaught exception: ${err?.stack ?? err}`;
  debugLog(msg);
  originalStderrWrite(msg + '\n');
  cleanup(1);
});
process.on('unhandledRejection', (reason) => {
  const msg = `Unhandled rejection: ${reason instanceof Error ? reason.stack : reason}`;
  debugLog(msg);
  originalStderrWrite(msg + '\n');
  cleanup(1);
});

await new Promise(resolve => setTimeout(resolve, 100));

debugLog('Creating renderer...');
try {
  const renderer = await createCliRenderer();
  debugLog('Renderer created, mounting React...');
  createRoot(renderer).render(<App initialMessage={parsed.initialMessage} />);
  debugLog('React mounted');
} catch (error) {
  debugLog(`Renderer/React error: ${error}`);
  console.error(error);
  cleanup(1);
}