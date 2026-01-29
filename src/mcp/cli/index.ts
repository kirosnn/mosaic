export async function runMcpCli(args: string[]): Promise<void> {
  const command = args[0] || 'help';
  const rest = args.slice(1);

  switch (command) {
    case 'list':
    case 'ls': {
      const { mcpList } = await import('./list');
      await mcpList();
      break;
    }

    case 'tools': {
      const { mcpTools } = await import('./tools');
      await mcpTools(rest[0]);
      break;
    }

    case 'doctor': {
      const { mcpDoctor } = await import('./doctor');
      await mcpDoctor();
      break;
    }

    case 'logs': {
      const { mcpLogs } = await import('./logs');
      await mcpLogs(rest[0]);
      break;
    }

    case 'show': {
      const { mcpShow } = await import('./show');
      await mcpShow(rest[0]);
      break;
    }

    case 'add': {
      const { mcpAdd } = await import('./add');
      await mcpAdd(rest[0]);
      break;
    }

    case 'remove':
    case 'enable':
    case 'disable':
    case 'restart':
    case 'start':
    case 'stop':
    case 'refresh': {
      const { mcpManage } = await import('./manage');
      await mcpManage(command, rest[0]);
      break;
    }

    case 'help':
    default:
      showMcpHelp();
      break;
  }
}

function showMcpHelp(): void {
  console.log(`
Mosaic MCP - Model Context Protocol client

Usage:
  mosaic mcp <command> [options]

Commands:
  list                 List configured MCP servers
  tools [serverId]     List available MCP tools
  doctor               Run diagnostics on MCP servers
  logs <serverId>      Show server logs
  show <serverId>      Show server config and state
  add [name]           Add an MCP server (by name or from the list)
  remove <serverId>    Remove a server
  enable <serverId>    Enable a server
  disable <serverId>   Disable a server
  start <serverId>     Start a server
  stop <serverId>      Stop a server
  restart <serverId>   Restart a server
  refresh [serverId]   Refresh tool catalog
  help                 Show this help
`);
}