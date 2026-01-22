export function formatToolCallMessage(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
        case 'read':
            return `Reading: ${args.path || 'file'}`;
        case 'write':
            return `Writing: ${args.path || 'file'}`;
        case 'edit':
            return `Editing: ${args.path || 'file'}`;
        case 'list':
            return `Listing: ${args.path || 'directory'}`;
        case 'bash':
            return `Running: ${args.command || 'command'}`;
        case 'glob':
            return `Searching: ${args.pattern || 'pattern'}`;
        case 'grep':
            return `Searching: ${args.pattern || 'pattern'}`;
        case 'question':
            return 'Asking question...';
        default:
            return `Running: ${toolName}`;
    }
}

export function formatToolResult(toolName: string, args: Record<string, unknown>, result: unknown): string {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const preview = resultStr.length > 500 ? resultStr.slice(0, 500) + '...' : resultStr;

    switch (toolName) {
        case 'read':
            return `Read ${args.path || 'file'}:\n${preview}`;
        case 'write':
            return `Wrote to ${args.path || 'file'}`;
        case 'edit':
            return `Edited ${args.path || 'file'}`;
        case 'list':
            return `Listed ${args.path || 'directory'}:\n${preview}`;
        case 'bash':
            return `Command output:\n${preview}`;
        case 'glob':
            return `Found files:\n${preview}`;
        case 'grep':
            return `Search results:\n${preview}`;
        default:
            return preview;
    }
}

export const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;