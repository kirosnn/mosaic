import { getMcpManager } from '../index';

export async function mcpLogs(serverId?: string): Promise<void> {
  if (!serverId) {
    console.log('Usage: mosaic mcp logs <serverId>');
    return;
  }

  const manager = getMcpManager();
  const logs = manager.getLogs(serverId);

  if (logs.length === 0) {
    console.log(`No logs for server "${serverId}".`);
    return;
  }

  console.log(`Logs for ${serverId} (${logs.length} entries):\n`);

  for (const entry of logs) {
    const time = new Date(entry.timestamp).toISOString().slice(11, 23);
    const level = entry.level.toUpperCase().padEnd(5);
    console.log(`[${time}] ${level} ${entry.message}`);
  }
}