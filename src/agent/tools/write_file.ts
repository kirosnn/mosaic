import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const write_file: CoreTool = tool({
  description: 'Write or overwrite a file in the workspace',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
    content: z.string().describe('The content to write to the file'),
  }),
  execute: async (args) => {
    const result = await executeTool('write_file', args);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result;
  },
});