import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const grep: CoreTool = tool({
  description: 'Search for files and/or text content within files. Can search by file pattern only, or search for text content within matching files.',
  parameters: z.object({
    file_pattern: z.string().describe('Glob pattern to match files (e.g., "*.ts", "**/*.tsx", "src/**/*.js"). This is required.'),
    query: z.string().optional().describe('Text content to search for within the matched files. If omitted, only returns matching file paths.'),
    path: z.string().optional().describe('Directory to search in (default: workspace root, use ".")'),
    case_sensitive: z.boolean().optional().describe('Whether text search should be case-sensitive (default: false). Only used if query is provided.'),
    max_results: z.number().optional().describe('Maximum number of results to return (default: 100). Only used if query is provided.'),
  }),
  execute: async (args) => {
    const result = await executeTool('grep', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
