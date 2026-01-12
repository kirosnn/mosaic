import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const list_files: CoreTool = tool({
  description: 'List files and directories in a directory',
  parameters: z.object({
    path: z
      .string()
      .describe('The path to the directory relative to the workspace root. Use "." for the root directory.'),
  }),
  execute: async (args) => {
    const result = await executeTool('list_files', args);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result;
  },
});
