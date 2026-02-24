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
import { debugLog, initDebugSession } from './utils/debug';

interface ParsedArgs {
  directory?: string;
  help?: boolean;
  initialMessage?: string;
  uninstall?: boolean;
  forceUninstall?: boolean;
  mcpCommand?: boolean;
  mcpArgs?: string[];
  authCommand?: boolean;
  authArgs?: string[];
  usageCommand?: boolean;
  usageArgs?: string[];
  resumeCommand?: boolean;
  resumeId?: string;
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
      } else if (arg === 'resume') {
        parsed.resumeCommand = true;
        const candidate = args[i + 1];
        if (candidate && !candidate.startsWith('-')) {
          parsed.resumeId = candidate;
          i += 2;
        } else {
          i++;
        }
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
      } else if (arg === 'auth') {
        parsed.authCommand = true;
        parsed.authArgs = args.slice(i + 1);
        i = args.length;
      } else if (arg === 'usage') {
        parsed.usageCommand = true;
        parsed.usageArgs = args.slice(i + 1);
        i = args.length;
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
  resume [id]               ${gray('Open a menu to resume a previous conversation session (or resume directly by id)')}
  auth <subcommand>         ${gray('Manage API keys and authentication')}
  mcp <subcommand>          ${gray('Manage Model Context Protocol (MCP) servers')}
  usage [options]           ${gray('Open usage dashboard in TUI')}
  uninstall [--force]       ${gray('Uninstall Mosaic from your system')}

${gold('Auth Subcommands')}
  mosaic auth list           ${gray('List stored API keys (masked)')}
  mosaic auth set            ${gray('Add or update an API key')}
  mosaic auth remove         ${gray('Remove a stored API key')}
  mosaic auth login <prov>   ${gray('OAuth login')}
  mosaic auth help           ${gray('View full list of auth commands')}

${gold('MCP Subcommands')}
  mosaic mcp list           ${gray('List configured MCP servers')}
  mosaic mcp add [name]     ${gray('Add a new MCP server')}
  mosaic mcp doctor         ${gray('Run diagnostics')}
  mosaic mcp help           ${gray('View full list of MCP commands')}

${gold('Examples')}
  ${gray('mosaic')}                              # Start in current directory
  ${gray('mosaic ./my-project')}                 # Start in specific directory
  ${gray('mosaic run "Fix the bug in main.ts"')} # Launch with a specific task
  ${gray('mosaic resume')}                       # Resume a previous session
  ${gray('mosaic resume <id>')}                  # Resume a specific session by id
  ${gray('mosaic auth set --provider openai --token sk-...')} # Store an API key
  ${gray('mosaic mcp list')}                     # Check connected tools
  ${gray('mosaic usage --workspace')}            # Open usage dashboard for current workspace only
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
const startupSessionId = `session-${Date.now()}-${process.pid}`;
initDebugSession(startupSessionId);
debugLog(`[boot] startup pid=${process.pid} cwd=${process.cwd()} args=${JSON.stringify(args)}`);
debugLog(`[boot] parsedArgs=${JSON.stringify(parsed)}`);

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

if (parsed.authCommand) {
  const { runAuthCli } = await import('./auth/cli');
  await runAuthCli(parsed.authArgs ?? []);
  process.exit(0);
}

if (parsed.usageCommand) {
  const usageArgs = parsed.usageArgs ?? [];
  const suffix = usageArgs.join(' ').trim();
  parsed.initialMessage = suffix ? `/usage ${suffix}` : '/usage';
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
  debugLog(`[boot] cwd changed to ${resolvedPath}`);
}

import { addRecentProject } from './utils/config';
import type { Message } from './components/main/types';
import { getLastConversationId, loadConversationById, type ConversationHistory, type ConversationStep } from './utils/history';

function printResumeHint(): void {
  const lastId = getLastConversationId();
  if (!lastId) return;
  console.log(`\nVous pouvez poursuivre la conversation avec : mosaic resume ${lastId}\n`);
}

function convertStepsToMessages(steps: ConversationStep[]): Message[] {
  return steps.map((step, index) => {
    const baseId = `restored-${index}-${Date.now()}`;

    if (step.type === 'user') {
      return {
        id: baseId,
        role: 'user' as const,
        content: step.content,
        images: step.images,
        timestamp: step.timestamp
      };
    } else if (step.type === 'assistant') {
      return {
        id: baseId,
        role: 'assistant' as const,
        content: step.content,
        thinkingContent: step.thinkingContent,
        responseDuration: step.responseDuration,
        blendWord: step.blendWord,
        timestamp: step.timestamp
      };
    } else {
      return {
        id: baseId,
        role: 'tool' as const,
        content: step.content,
        toolName: step.toolName,
        toolArgs: step.toolArgs,
        toolResult: step.toolResult,
        success: true,
        timestamp: step.timestamp
      };
    }
  });
}

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
  printResumeHint();
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
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  debugLog('Renderer created, mounting React...');

  if (parsed.resumeCommand) {
    if (parsed.resumeId) {
      const conversation = loadConversationById(parsed.resumeId);
      if (!conversation) {
        console.error(`Session introuvable pour l'id : ${parsed.resumeId}`);
        cleanup(1);
      } else {
        const messages = convertStepsToMessages(conversation.steps);
        const title = conversation.title ?? null;
        const workspace = conversation.workspace;

        if (workspace && existsSync(workspace)) {
          process.chdir(workspace);
        }

        createRoot(renderer).render(
          <App
            initialMessages={messages}
            initialTitle={title}
          />
        );
      }
    } else {
      const { Resume } = await import('./components/Resume');

      let hasSelected = false;

      const handleSelect = (conversation: ConversationHistory) => {
        if (hasSelected) return;
        hasSelected = true;

        const messages = convertStepsToMessages(conversation.steps);
        const title = conversation.title ?? null;
        const workspace = conversation.workspace;

        if (workspace && existsSync(workspace)) {
          process.chdir(workspace);
        }

        createRoot(renderer).render(
          <App
            initialMessages={messages}
            initialTitle={title}
          />
        );
      };

      const handleCancel = () => {
        cleanup(0);
      };

      createRoot(renderer).render(
        <Resume onSelect={handleSelect} onCancel={handleCancel} />
      );
    }
  } else {
    createRoot(renderer).render(<App initialMessage={parsed.initialMessage} />);
  }

  debugLog('React mounted');
} catch (error) {
  debugLog(`Renderer/React error: ${error}`);
  console.error(error);
  cleanup(1);
}
