import { loadMcpConfig } from '../config';
import { getMcpManager } from '../index';

export async function mcpShow(serverId?: string): Promise<void> {
  if (!serverId) {
    console.log('Usage: mosaic mcp show <serverId>');
    return;
  }

  const configs = loadMcpConfig();
  const config = configs.find(c => c.id === serverId);

  if (!config) {
    console.log(`Server "${serverId}" not found.`);
    return;
  }

  console.log(`Server: ${config.id}`);
  console.log(`  Name:      ${config.name}`);
  console.log(`  Enabled:   ${config.enabled}`);
  console.log(`  Command:   ${config.command} ${config.args.join(' ')}`);
  if (config.cwd) console.log(`  CWD:       ${config.cwd}`);
  console.log(`  Autostart: ${config.autostart}`);
  console.log(`  Approval:  ${config.approval}`);
  console.log(`  Timeouts:  init=${config.timeouts.initialize}ms, call=${config.timeouts.call}ms`);
  console.log(`  Limits:    ${config.limits.maxCallsPerMinute} calls/min, ${config.limits.maxPayloadBytes} bytes max`);
  console.log(`  Logs:      persist=${config.logs.persist}, buffer=${config.logs.bufferSize}`);

  if (config.tools.allow) console.log(`  Allow:     ${config.tools.allow.join(', ')}`);
  if (config.tools.deny) console.log(`  Deny:      ${config.tools.deny.join(', ')}`);

  if (config.env) {
    console.log(`  Env:`);
    for (const [key, value] of Object.entries(config.env)) {
      console.log(`    ${key}=${value.length > 30 ? value.slice(0, 30) + '...' : value}`);
    }
  }

  const manager = getMcpManager();
  const state = manager.getState(serverId);

  if (state) {
    console.log(`\nRuntime State:`);
    console.log(`  Status:     ${state.status}`);
    if (state.pid) console.log(`  PID:        ${state.pid}`);
    if (state.initLatencyMs) console.log(`  Init:       ${state.initLatencyMs}ms`);
    console.log(`  Tools:      ${state.toolCount}`);
    if (state.lastError) console.log(`  Last Error: ${state.lastError}`);
    if (state.lastCallAt) console.log(`  Last Call:  ${new Date(state.lastCallAt).toISOString()}`);
  } else {
    console.log(`\nRuntime State: not started`);
  }
}