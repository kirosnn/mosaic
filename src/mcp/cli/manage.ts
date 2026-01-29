import { loadMcpConfig, removeServerConfig, updateServerConfig } from '../config';
import { getMcpManager, initializeMcp } from '../index';

export async function mcpManage(command: string, serverId?: string): Promise<void> {
  if (!serverId && command !== 'refresh') {
    console.log(`Usage: mosaic mcp ${command} <serverId>`);
    return;
  }

  switch (command) {
    case 'remove': {
      const removed = removeServerConfig(serverId!);
      if (removed) {
        console.log(`Server "${serverId}" removed.`);
      } else {
        console.log(`Server "${serverId}" not found.`);
      }
      break;
    }

    case 'enable': {
      const result = updateServerConfig(serverId!, { enabled: true });
      if (result) {
        console.log(`Server "${serverId}" enabled.`);
      } else {
        console.log(`Server "${serverId}" not found.`);
      }
      break;
    }

    case 'disable': {
      const result = updateServerConfig(serverId!, { enabled: false });
      if (result) {
        console.log(`Server "${serverId}" disabled.`);
      } else {
        console.log(`Server "${serverId}" not found.`);
      }
      break;
    }

    case 'start': {
      const configs = loadMcpConfig();
      const config = configs.find(c => c.id === serverId);
      if (!config) {
        console.log(`Server "${serverId}" not found.`);
        return;
      }

      const manager = getMcpManager();
      console.log(`Starting server "${serverId}"...`);
      const state = await manager.startServer(config);
      console.log(`Status: ${state.status}`);
      if (state.lastError) console.log(`Error: ${state.lastError}`);
      if (state.toolCount > 0) console.log(`Tools: ${state.toolCount}`);
      break;
    }

    case 'stop': {
      const manager = getMcpManager();
      console.log(`Stopping server "${serverId}"...`);
      await manager.stopServer(serverId!);
      console.log(`Server "${serverId}" stopped.`);
      break;
    }

    case 'restart': {
      const manager = getMcpManager();
      console.log(`Restarting server "${serverId}"...`);
      const state = await manager.restartServer(serverId!);
      if (state) {
        console.log(`Status: ${state.status}`);
        if (state.toolCount > 0) console.log(`Tools: ${state.toolCount}`);
      } else {
        console.log(`Server "${serverId}" not found.`);
      }
      break;
    }

    case 'refresh': {
      await initializeMcp();
      const { getMcpCatalog } = await import('../index');
      try {
        const catalog = getMcpCatalog();
        catalog.refreshTools(serverId);
        const tools = catalog.getMcpToolInfos();
        const count = serverId
          ? tools.filter(t => t.serverId === serverId).length
          : tools.length;
        console.log(`Refreshed. ${count} MCP tool(s) available.`);
      } catch {
        console.log('MCP not initialized. No servers configured or all failed.');
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
  }
}