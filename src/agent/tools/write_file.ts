import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const write_file: CoreTool = tool({
  description: 'Write or overwrite a file in the workspace. Creates parent directories automatically if they do not exist.',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
    content: z.string().optional().describe('The content to write to the file (default: empty string)'),
    append: z.boolean().optional().describe('If true, append to the file instead of overwriting (default: false)'),
  }),
  execute: async (args) => {
    const result = await executeTool('write_file', args);
    if (!result.success) return { error: result.error };
    return result.result;
  },
});