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

import { cli } from './cli';
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import App from "./components/App";
import { existsSync } from 'fs';
import { resolve } from 'path';
import { setTerminalTitle, clearTerminal } from './utils/terminalUtils';

const args = process.argv.slice(2);

if (args.length > 0) {
  const parsed = cli.parseArgs(args);

  if (parsed.help) {
    cli.showHelp();
    process.exit(0);
  }

  if (parsed.directory) {
    const targetDir = resolve(parsed.directory);

    if (!existsSync(targetDir)) {
      console.error(`Error: Directory "${parsed.directory}" does not exist.`);
      process.exit(1);
    }

    try {
      process.chdir(targetDir);
    } catch (error) {
      console.error(`Error: Cannot change to directory "${parsed.directory}"`);
      process.exit(1);
    }
  }
}

setTerminalTitle('✹ Mosaic');

const cleanup = (code = 0) => {
  process.stdout.write('\x1b[?25h');
  clearTerminal();
  process.exit(code);
};

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('uncaughtException', () => cleanup(1));
process.on('unhandledRejection', () => cleanup(1));
process.on('beforeExit', () => clearTerminal());

await new Promise(resolve => setTimeout(resolve, 100));
clearTerminal();

try {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
} catch {
  cleanup(1);
}