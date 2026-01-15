import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const list: CoreTool = tool({
  description: 'List files and directories in a directory with optional recursive listing and filtering',
  parameters: z.object({
    path: z
      .string()
      .describe('The path to the directory relative to the workspace root. Use "." for the root directory.'),
    recursive: z.boolean().nullable().optional().describe('If true, list files recursively in all subdirectories (use null for false)'),
    filter: z.string().nullable().optional().describe('Optional glob pattern to filter results (use null for no filter)'),
    include_hidden: z.boolean().nullable().optional().describe('If true, include hidden files (starting with .) (use null for false)'),
  }),
  execute: async (args) => {
    const result = await executeTool('list', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});