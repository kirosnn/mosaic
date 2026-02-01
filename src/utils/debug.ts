import { appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEBUG_LOG = join(homedir(), '.mosaic', 'debug.log');

export function debugLog(message: string): void {
  try {
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch { }
}

export function maskToken(value?: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****' + value.slice(-4);
  return value.slice(0, 4) + '...' + value.slice(-4);
}
