import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const glob: CoreTool = tool({
  description: 'Find files matching a glob pattern. Fast pattern-based file discovery.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files (e.g., "*.ts", "**/*.tsx", "src/**/*.js")'),
    path: z.string().nullable().optional().describe('Directory to search in (use null for workspace root)'),
  }),
  execute: async (args) => {
    const result = await executeTool('glob', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
