import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';
import { checkDuplicate, recordCall } from './toolCallTracker';

export const list: CoreTool = tool({
  description: 'List files and directories in a local directory with optional recursive listing and filtering. Relative paths resolve from the launch directory; absolute paths, ~, and environment-variable paths are also supported.',
  parameters: z.object({
    path: z
      .string()
      .describe('Directory path. Relative paths resolve from the launch directory. Use "." for that root.'),
    recursive: z.boolean().nullable().optional().describe('If true, list files recursively in all subdirectories (use null for false)'),
    filter: z.string().nullable().optional().describe('Optional glob pattern to filter results (use null for no filter)'),
    include_hidden: z.boolean().nullable().optional().describe('If true, include hidden files (starting with .) (use null for false)'),
  }),
  execute: async (args) => {
    const cached = checkDuplicate('list', args);
    if (cached) return cached.result;
    const result = await executeTool('list', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    let count = 0;
    try {
      const parsed = JSON.parse(result.result!);
      if (Array.isArray(parsed)) {
        count = parsed.length;
      } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { files?: unknown[] }).files)) {
        count = ((parsed as { files: unknown[] }).files).length;
      }
    } catch {}
    recordCall('list', args, result.result!, `${count} items`);
    return result.result;
  },
});
