import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const grep: CoreTool = tool({
  description: 'Search for text content within files matching a glob pattern. Combines pattern matching with content search.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files (e.g., "*.ts", "**/*.tsx", "src/**/*.js")'),
    query: z.string().describe('Text content to search for within the matched files'),
    path: z.string().nullable().optional().describe('Directory to search in (use null for workspace root)'),
    case_sensitive: z.boolean().nullable().optional().describe('Whether text search should be case-sensitive (use null for false)'),
    max_results: z.number().nullable().optional().describe('Maximum number of results to return (use null for 100)'),
  }),
  execute: async (args) => {
    const result = await executeTool('grep', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});