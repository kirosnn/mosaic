import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const read_file: CoreTool = tool({
  description: 'Read the contents of a file from the workspace',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
  }),
  execute: async (args) => {
    const result = await executeTool('read_file', args);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result;
  },
});
