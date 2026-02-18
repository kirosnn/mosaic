import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';
import { trackMutation } from './toolCallTracker';

export const edit: CoreTool = tool({
  description: 'Edit a specific part of a file by replacing old content with new content. More precise than rewriting the entire file. IMPORTANT: This operation requires user approval - the user will see a preview showing the old and new content and must approve before changes are made. If rejected, ask the user for clarification using the question tool.',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
    old_content: z.string().describe('The exact text content to find and replace'),
    new_content: z.string().describe('The new text content to replace with'),
    occurrence: z.number().nullable().optional().describe('Which occurrence to replace (1 for first, 2 for second, etc. Use null for 1)'),
  }),
  execute: async (args) => {
    const result = await executeTool('edit', args);
    if (!result.success) {
      const errorMessage = result.error || 'Unknown error occurred';
      return result.userMessage
        ? { error: errorMessage, userMessage: result.userMessage }
        : { error: errorMessage };
    }
    if (typeof args.path === 'string' && args.path.trim()) {
      trackMutation(args.path);
    } else {
      trackMutation();
    }
    return result;
  },
});
