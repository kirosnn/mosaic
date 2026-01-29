import { loadMcpConfig } from '../config';
import { getMcpManager } from '../index';

export async function mcpTools(serverId?: string): Promise<void> {
  const configs = loadMcpConfig();

  if (configs.length === 0) {
    console.log('No MCP servers configured.');
    return;
  }

  const manager = getMcpManager();
  const targetConfigs = serverId ? configs.filter(c => c.id === serverId) : configs;

  if (serverId && targetConfigs.length === 0) {
    console.log(`Server "${serverId}" not found.`);
    return;
  }

  let totalTools = 0;

  for (const config of targetConfigs) {
    const state = manager.getState(config.id);
    if (!state || state.status !== 'running') {
      console.log(`\n[${config.id}] (${state?.status || 'not started'})`);
      continue;
    }

    const tools = manager.listTools(config.id);
    console.log(`\n[${config.id}] ${config.name} - ${tools.length} tools`);

    if (tools.length === 0) {
      console.log('  (no tools)');
      continue;
    }

    const deny = config.tools.deny || [];
    const allow = config.tools.allow || [];

    for (const t of tools) {
      let status = 'exposed';
      if (deny.length > 0 && deny.some(p => matchPattern(t.name, p))) {
        status = 'denied';
      } else if (allow.length > 0 && !allow.some(p => matchPattern(t.name, p))) {
        status = 'denied';
      }

      const desc = t.description ? ` - ${t.description.slice(0, 60)}` : '';
      console.log(`  ${status === 'denied' ? 'x' : '+'} ${t.canonicalId}${desc}`);

      if (t.inputSchema && typeof t.inputSchema === 'object') {
        const props = (t.inputSchema as any).properties;
        if (props && typeof props === 'object') {
          const required = ((t.inputSchema as any).required || []) as string[];
          for (const [key, schema] of Object.entries(props as Record<string, any>)) {
            const type = schema.type || 'unknown';
            const req = required.includes(key) ? 'required' : 'optional';
            console.log(`    - ${key} (${type}, ${req})`);
          }
        }
      }

      totalTools++;
    }
  }

  console.log(`\nTotal: ${totalTools} tools`);
}

function matchPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === name) return true;
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(name);
}