import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const grep: CoreTool = tool({
  description: 'Search for files and/or text content within files. Can search by file pattern only, or search for text content within matching files.',
  parameters: z.object({
    file_pattern: z.string().describe('Glob pattern to match files (e.g., "*.ts", "**/*.tsx", "src/**/*.js"). This is required.'),
    query: z.string().nullable().optional().describe('Text content to search for within the matched files. Use null to only return matching file paths.'),
    path: z.string().nullable().optional().describe('Directory to search in (use null for workspace root, use ".")'),
    case_sensitive: z.boolean().nullable().optional().describe('Whether text search should be case-sensitive (use null for false). Only used if query is provided.'),
    max_results: z.number().nullable().optional().describe('Maximum number of results to return (use null for 100). Only used if query is provided.'),
  }),
  execute: async (args) => {
    const result = await executeTool('grep', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});