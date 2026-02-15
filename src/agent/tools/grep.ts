import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';
import { checkDuplicate, recordCall } from './toolCallTracker';

const FILE_TYPE_EXTENSIONS: Record<string, string[]> = {
  ts: ['.ts', '.tsx', '.mts', '.cts'],
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  py: ['.py', '.pyw', '.pyi'],
  java: ['.java'],
  go: ['.go'],
  rust: ['.rs'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
  cs: ['.cs'],
  rb: ['.rb', '.rake', '.gemspec'],
  php: ['.php', '.phtml'],
  swift: ['.swift'],
  kt: ['.kt', '.kts'],
  scala: ['.scala'],
  html: ['.html', '.htm', '.xhtml'],
  css: ['.css', '.scss', '.sass', '.less'],
  json: ['.json', '.jsonc'],
  yaml: ['.yaml', '.yml'],
  md: ['.md', '.markdown'],
  txt: ['.txt'],
  sh: ['.sh', '.bash', '.zsh'],
  sql: ['.sql'],
  vue: ['.vue'],
  svelte: ['.svelte'],
};

export { FILE_TYPE_EXTENSIONS };

export const grep: CoreTool = tool({
  description: `Search for text within files using regular expressions.
  
RECOMMENDED: Use file_type for best results (automatically searches all subdirectories).

Examples:
- grep(query="interface User", file_type="ts") - Search in TypeScript files
- grep(query="export function", file_type="tsx") - Search in React files
- grep(query="TODO") - Search in all files
- grep(query="class.*Component", file_type="ts") - Reuse regex search
- grep(query="handleClick", output_mode="files") - Just list matching files`,
  parameters: z.object({
    query: z.string().describe('Regular expression pattern to search for'),
    file_type: z.string().optional().describe('File type or extension (e.g. ts, tsx, js, txt, .env). Unknown types are treated as extensions.'),
    pattern: z.string().optional().describe('Glob pattern for files (e.g., "**/*.config.ts"). Usually file_type is easier.'),
    path: z.string().optional().describe('Directory to search (defaults to workspace root)'),
    case_sensitive: z.boolean().optional().describe('Case-sensitive (default: false)'),
    whole_word: z.boolean().optional().describe('Match whole words only (default: false)'),
    context: z.number().optional().describe('Lines of context around matches (default: 0)'),
    max_results: z.number().optional().describe('Max results (default: 500)'),
    output_mode: z.enum(['matches', 'files', 'count']).optional().describe('"matches" (default), "files", or "count"'),
    exclude_pattern: z.string().optional().describe('Glob pattern to exclude'),
  }),
  execute: async (args) => {
    const cleanArgs: Record<string, unknown> = { query: args.query, regex: true };

    if (args.file_type && args.file_type !== 'null') cleanArgs.file_type = args.file_type;
    if (args.pattern && args.pattern !== 'null') cleanArgs.pattern = args.pattern;
    if (args.path && args.path !== 'null') cleanArgs.path = args.path;
    if (args.case_sensitive !== undefined && args.case_sensitive !== null) cleanArgs.case_sensitive = args.case_sensitive;
    if (args.whole_word !== undefined && args.whole_word !== null) cleanArgs.whole_word = args.whole_word;
    if (args.context !== undefined && args.context !== null) cleanArgs.context = args.context;
    if (args.max_results !== undefined && args.max_results !== null) cleanArgs.max_results = args.max_results;
    if (args.output_mode && (args.output_mode as string) !== 'null') cleanArgs.output_mode = args.output_mode;
    if (args.exclude_pattern && args.exclude_pattern !== 'null') cleanArgs.exclude_pattern = args.exclude_pattern;

    const cached = checkDuplicate('grep', cleanArgs);
    if (cached) return cached.result;
    const result = await executeTool('grep', cleanArgs);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    let count = 0;
    try { count = JSON.parse(result.result!).length; } catch {}
    recordCall('grep', cleanArgs, result.result!, `${count} matches`);
    return result.result;
  },
});
