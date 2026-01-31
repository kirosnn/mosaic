import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureContext } from './browser.js';
import { registerTools } from './tools.js';

const server = new McpServer({ name: 'navigation', version: '1.0.0' });

registerTools(server);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    try {
        await ensureContext();
    } catch {
        // Browser will be launched on first tool call if pre-launch fails
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});