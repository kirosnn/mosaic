import { loadMcpConfig } from '../config';
import { McpProcessManager } from '../processManager';
import { platform } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function mcpDoctor(): Promise<void> {
  const configs = loadMcpConfig();

  if (configs.length === 0) {
    console.log('No MCP servers configured. Nothing to diagnose.');
    return;
  }

  console.log(`Diagnosing ${configs.length} MCP server(s)...\n`);

  const manager = new McpProcessManager();
  let pass = 0;
  let fail = 0;

  for (const config of configs) {
    console.log(`--- ${config.id} (${config.name}) ---`);

    console.log('  [config] OK');

    const commandExists = await checkCommand(config.command);
    if (commandExists) {
      console.log(`  [command] "${config.command}" found`);
    } else {
      console.log(`  [command] WARNING: "${config.command}" not found on PATH`);
    }

    if (!config.enabled) {
      console.log('  [status] DISABLED - skipping connectivity test');
      console.log('');
      continue;
    }

    try {
      const state = await manager.startServer(config);

      if (state.status === 'running') {
        console.log(`  [connect] OK (${state.initLatencyMs}ms)`);
        console.log(`  [tools] ${state.toolCount} tool(s) discovered`);
        pass++;
      } else {
        console.log(`  [connect] FAILED: ${state.lastError || 'unknown error'}`);
        fail++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  [connect] FAILED: ${message}`);
      fail++;
    }

    console.log('');
  }

  await manager.shutdownAll();

  console.log(`\nResults: ${pass} passed, ${fail} failed, ${configs.length - pass - fail} skipped`);
}

async function checkCommand(command: string): Promise<boolean> {
  const which = platform() === 'win32' ? 'where' : 'which';
  try {
    await execAsync(`${which} ${command}`);
    return true;
  } catch {
    return false;
  }
}