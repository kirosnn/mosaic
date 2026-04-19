import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';
import { checkDuplicate, recordCall } from './toolCallTracker';

export const read: CoreTool = tool({
  description: 'Read the contents of a local file. Relative paths resolve from the launch directory; absolute paths, ~, and environment-variable paths are also supported.',
  parameters: z.object({
    path: z.string().describe('File path. Relative paths resolve from the launch directory; absolute and home-directory paths are allowed.'),
    start_line: z.number().optional().describe('The line number to start reading from (1-based)'),
    end_line: z.number().optional().describe('The line number to end reading at (1-based)'),
  }),
  execute: async (args) => {
    const cached = checkDuplicate('read', args);
    if (cached) return cached.result;
    const result = await executeTool('read', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    const lines = (result.result || '').split('\n').length;
    recordCall('read', args, result.result!, `${lines} lines`);
    return result.result;
  },
});
