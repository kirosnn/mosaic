import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const read: CoreTool = tool({
  description: 'Read the contents of a file from the workspace',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
    start_line: z.number().optional().describe('The line number to start reading from (1-based)'),
    end_line: z.number().optional().describe('The line number to end reading at (1-based)'),
  }),
  execute: async (args) => {
    const result = await executeTool('read', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});