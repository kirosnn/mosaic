import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const list_files: CoreTool = tool({
  description: 'List files and directories in a directory with optional recursive listing and filtering',
  parameters: z.object({
    path: z
      .string()
      .describe('The path to the directory relative to the workspace root. Use "." for the root directory.'),
    recursive: z.boolean().optional().describe('If true, list files recursively in all subdirectories (default: false)'),
    filter: z.string().optional().describe('Optional glob pattern to filter results (e.g., "*.ts", "*.{js,ts}")'),
    include_hidden: z.boolean().optional().describe('If true, include hidden files (starting with .) (default: false)'),
  }),
  execute: async (args) => {
    const result = await executeTool('list_files', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
