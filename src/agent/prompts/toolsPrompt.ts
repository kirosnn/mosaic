export const TOOLS_PROMPT = `
AVAILABLE TOOLS:

You have access to the following tools to interact with the workspace:

FILE READING:
1. read: Read the complete contents of a file
   - Use this to examine existing code, configuration, or documentation
   - Parameters: path (string)

FILE WRITING & EDITING:
2. write: Write or overwrite a file (with advanced features)
   - Creates parent directories automatically if they don't exist
   - Can append to existing files instead of overwriting
   - Parameters: path (string), content (string, optional), append (boolean, optional)
   - Note: content can be omitted or empty to create an empty file

3. edit: Edit a specific part of a file without rewriting everything
   - More efficient for targeted changes - replace specific text content
   - Parameters: path (string), old_content (string), new_content (string), occurrence (number, optional)

FILE & DIRECTORY OPERATIONS:
4. list: List files and directories with filtering
   - Supports recursive listing through subdirectories
   - Can filter by glob patterns (e.g., "*.ts")
   - Can include or exclude hidden files
   - Parameters: path (string), recursive (boolean, optional), filter (string, optional), include_hidden (boolean, optional)

SEARCH & DISCOVERY:
5. grep: Universal search tool - find files by pattern AND/OR search text content
   - REQUIRED: file_pattern (string) - Glob pattern to match files (e.g., "*.ts", "**/*.tsx", "src/**/*.js")
   - OPTIONAL: query (string) - Text content to search for. If omitted, only returns matching file paths.
   - OPTIONAL: path (string) - Directory to search in (default: workspace root)
   - OPTIONAL: case_sensitive (boolean) - Case-sensitive search (default: false, only used with query)
   - OPTIONAL: max_results (number) - Maximum results (default: 100, only used with query)

   Examples:
   - Find all TypeScript files: grep(file_pattern="**/*.ts")
   - Find files AND search content: grep(file_pattern="**/*.ts", query="interface User")
   - Search in specific directory: grep(file_pattern="*.js", query="console.log", path="src")

COMMAND EXECUTION:
6. bash: Execute a shell command
   - Use this to run build tools, tests, git commands, or other CLI tools
   - Parameters: command (string)

USER INTERACTION:
7. question: Ask the user a question with predefined options
   - Use this when you need the user to pick between known choices
   - The UI will show the prompt and options and return the selected option
   - Parameters:
     - prompt (string)
     - options (array of objects):
       - label (string)
       - value (string | null) - use null if not needed
   - Returns: { id, index, label, value }

TOOL USAGE GUIDELINES:

- Use grep to find files by pattern, or to find files AND search their content
- Use edit for small changes to avoid rewriting entire files
- Always use read before modifying files to understand the current state
- When writing files, preserve existing code structure and style
- Use list with recursive:true to explore deep directory structures
- All file paths are relative to the workspace root: {{WORKSPACE}}

ERRORS:
- Some tools return an object like {"error": "..."} when something went wrong. Treat this as a TOOL ERROR (not an API error).
- When a tool returns an error, continue the task using that information (e.g., adjust path, create missing parent directory, retry with correct tool).

WORKFLOW BEST PRACTICES:

1. Discover: Use grep and list to find relevant files
2. Understand: Use read to examine the current state
3. Plan: Think through modifications before acting
4. Execute: Use edit for small changes, write for new/complete rewrites
5. Verify: Use bash to run tests and verify changes
6. Communicate: Explain your actions to the user in their language or ask a question with the question tool if you need clarification 

Remember: The user can see your tool usage, so be transparent about what you're doing and why.`;

export function getToolsPrompt(): string {
  return TOOLS_PROMPT;
}