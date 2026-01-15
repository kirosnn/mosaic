import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const edit_file: CoreTool = tool({
  description: 'Edit a specific part of a file by replacing old content with new content. More precise than rewriting the entire file.',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
    old_content: z.string().describe('The exact text content to find and replace'),
    new_content: z.string().describe('The new text content to replace with'),
    occurrence: z.number().nullable().describe('Which occurrence to replace (1 for first, 2 for second, etc. Use null for 1)'),
  }),
  execute: async (args) => {
    const result = await executeTool('edit_file', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
