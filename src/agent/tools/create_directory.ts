import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const create_directory: CoreTool = tool({
  description: 'Create a new directory (creates parent directories automatically)',
  parameters: z.object({
    path: z.string().describe('The path of the directory to create'),
  }),
  execute: async (args) => {
    const result = await executeTool('create_directory', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
