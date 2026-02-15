import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';
import { checkDuplicate, recordCall } from './toolCallTracker';

export const glob: CoreTool = tool({
  description: `Find files matching a glob pattern. Fast pattern-based file discovery.

IMPORTANT: Use "**/" prefix to search recursively in all subdirectories.
- "*.ts" only matches files in the current directory
- "**/*.ts" matches files in ALL subdirectories (usually what you want)

Note: Do not use this to simply list files in a directory; use the 'list' tool for that. This is for finding specific files by pattern.

Examples:
- glob(pattern="**/*.ts") - All TypeScript files
- glob(pattern="**/*.tsx") - All React components
- glob(pattern="**/package.json") - All package.json files
- glob(pattern="src/**/*.js") - All JS files in src/`,
  parameters: z.object({
    pattern: z.string().describe('Glob pattern (use **/ for recursive search, e.g., "**/*.ts")'),
    path: z.string().optional().describe('Directory to search in (defaults to workspace root)'),
  }),
  execute: async (args) => {
    const cleanArgs = {
      pattern: args.pattern,
      path: args.path && args.path !== 'null' ? args.path : undefined,
    };
    const cached = checkDuplicate('glob', cleanArgs);
    if (cached) return cached.result;
    const result = await executeTool('glob', cleanArgs);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    let count = 0;
    try { count = JSON.parse(result.result!).length; } catch {}
    recordCall('glob', cleanArgs, result.result!, `${count} files`);
    return result.result;
  },
});
