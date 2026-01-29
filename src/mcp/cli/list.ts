import { loadMcpConfig } from '../config';
import { getMcpManager } from '../index';

export async function mcpList(): Promise<void> {
  const configs = loadMcpConfig();

  if (configs.length === 0) {
    console.log('No MCP servers configured.');
    console.log('Use "mosaic mcp add" to add a server.');
    return;
  }

  const manager = getMcpManager();

  const header = [
    pad('ID', 20),
    pad('Name', 20),
    pad('Enabled', 8),
    pad('Autostart', 10),
    pad('Status', 10),
    pad('Tools', 6),
    'Last Error',
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const config of configs) {
    const state = manager.getState(config.id);
    const status = state?.status || 'stopped';
    const toolCount = state?.toolCount ?? 0;
    const lastError = state?.lastError || '';

    const row = [
      pad(config.id, 20),
      pad(config.name, 20),
      pad(config.enabled ? 'yes' : 'no', 8),
      pad(config.autostart, 10),
      pad(status, 10),
      pad(String(toolCount), 6),
      lastError.length > 40 ? lastError.slice(0, 40) + '...' : lastError,
    ].join(' | ');

    console.log(row);
  }
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}