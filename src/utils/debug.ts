import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type LogCategory = 'memory' | 'context' | 'compaction' | 'agent' | 'tool' | 'explore' | 'general';

const DEBUG_LOG = join(homedir(), '.mosaic', 'debug.log');
const LATEST_LOG = join(homedir(), '.mosaic', 'debug-latest.log');

let currentSessionId: string | null = null;

export function initDebugSession(conversationId: string): void {
  currentSessionId = conversationId;
  try {
    writeFileSync(LATEST_LOG, `[${new Date().toISOString()}] [agent] session started id=${conversationId}\n`);
  } catch { }
}

export function debugLog(message: string, category?: LogCategory): void {
  const cat = category ?? inferCategory(message);
  const line = `[${new Date().toISOString()}] [${cat}] ${message}\n`;
  try {
    appendFileSync(DEBUG_LOG, line);
  } catch { }
  try {
    appendFileSync(LATEST_LOG, line);
  } catch { }
}

export function getLatestLogPath(): string {
  return LATEST_LOG;
}

export function getSessionId(): string | null {
  return currentSessionId;
}

export function maskToken(value?: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****' + value.slice(-4);
  return value.slice(0, 4) + '...' + value.slice(-4);
}

function inferCategory(message: string): LogCategory {
  if (message.startsWith('[memory]')) return 'memory';
  if (message.startsWith('[context]')) return 'context';
  if (message.startsWith('[compaction]')) return 'compaction';
  if (message.startsWith('[agent]')) return 'agent';
  if (message.startsWith('[tool]')) return 'tool';
  if (message.startsWith('[explore]')) return 'explore';
  return 'general';
}
