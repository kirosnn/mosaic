import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

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
  sh: ['.sh', '.bash', '.zsh'],
  sql: ['.sql'],
  vue: ['.vue'],
  svelte: ['.svelte'],
};

export { FILE_TYPE_EXTENSIONS };

export const grep: CoreTool = tool({
  description: `Search for text within files. Supports file types, glob patterns, regex, and context lines.

RECOMMENDED: Use file_type for best results (automatically searches all subdirectories).

Examples:
- grep(query="interface User", file_type="ts") - Search in TypeScript files
- grep(query="export function", file_type="tsx") - Search in React files
- grep(query="TODO") - Search in all files
- grep(query="class.*Component", regex=true, file_type="ts") - Regex search
- grep(query="handleClick", output_mode="files") - Just list matching files`,
  parameters: z.object({
    query: z.string().describe('Text to search for (literal unless regex=true)'),
    file_type: z.string().optional().describe('File type: ts, js, tsx, jsx, py, java, go, rust, c, cpp, rb, php, json, yaml, md, html, css'),
    pattern: z.string().optional().describe('Glob pattern for files (e.g., "**/*.config.ts"). Usually file_type is easier.'),
    path: z.string().optional().describe('Directory to search (defaults to workspace root)'),
    regex: z.boolean().optional().describe('Treat query as regex (default: false)'),
    case_sensitive: z.boolean().optional().describe('Case-sensitive (default: false)'),
    whole_word: z.boolean().optional().describe('Match whole words only (default: false)'),
    context: z.number().optional().describe('Lines of context around matches (default: 0)'),
    max_results: z.number().optional().describe('Max results (default: 500)'),
    output_mode: z.enum(['matches', 'files', 'count']).optional().describe('"matches" (default), "files", or "count"'),
    exclude_pattern: z.string().optional().describe('Glob pattern to exclude'),
  }),
  execute: async (args) => {
    const cleanArgs: Record<string, unknown> = { query: args.query };

    if (args.file_type && args.file_type !== 'null') cleanArgs.file_type = args.file_type;
    if (args.pattern && args.pattern !== 'null') cleanArgs.pattern = args.pattern;
    if (args.path && args.path !== 'null') cleanArgs.path = args.path;
    if (args.regex !== undefined && args.regex !== null) cleanArgs.regex = args.regex;
    if (args.case_sensitive !== undefined && args.case_sensitive !== null) cleanArgs.case_sensitive = args.case_sensitive;
    if (args.whole_word !== undefined && args.whole_word !== null) cleanArgs.whole_word = args.whole_word;
    if (args.context !== undefined && args.context !== null) cleanArgs.context = args.context;
    if (args.max_results !== undefined && args.max_results !== null) cleanArgs.max_results = args.max_results;
    if (args.output_mode && args.output_mode !== 'null') cleanArgs.output_mode = args.output_mode;
    if (args.exclude_pattern && args.exclude_pattern !== 'null') cleanArgs.exclude_pattern = args.exclude_pattern;

    const result = await executeTool('grep', cleanArgs);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
