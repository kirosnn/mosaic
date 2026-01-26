import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const fetch: CoreTool = tool({
  description: `Fetches a URL from the internet and extracts its contents as markdown.

This tool allows you to retrieve web content and process it for analysis. HTML pages are automatically converted to clean markdown format for easier reading.

Features:
- Automatic HTML to Markdown conversion with Readability
- Pagination support for large pages (use start_index to continue reading)
- Raw HTML retrieval option
- Link and image URL resolution to absolute paths
- Configurable content length limits

Use cases:
- Reading documentation and articles
- Fetching API responses (JSON, XML, etc.)
- Researching information from the web
- Analyzing web page content`,
  parameters: z.object({
    url: z.string().describe('The URL to fetch (must be a valid HTTP/HTTPS URL)'),
    max_length: z
      .number()
      .int()
      .positive()
      .max(100000)
      .nullable()
      .optional()
      .describe('Maximum number of characters to return (default: 10000, max: 100000)'),
    start_index: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe('Character index to start reading from. Use this to paginate through large pages when content is truncated.'),
    raw: z
      .boolean()
      .nullable()
      .optional()
      .describe('If true, return raw HTML instead of converting to markdown'),
    timeout: z
      .number()
      .int()
      .positive()
      .max(60000)
      .nullable()
      .optional()
      .describe('Request timeout in milliseconds (default: 30000, max: 60000)'),
  }),
  execute: async (args) => {
    const result = await executeTool('fetch', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});