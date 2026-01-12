export const TOOLS_PROMPT = `
AVAILABLE TOOLS:

You have access to the following tools to interact with the workspace:

1. read_file: Read the contents of a file
   - Use this to examine existing code, configuration, or documentation
   - Parameters: path (string)

2. write_file: Write or overwrite a file
   - Use this to create new files or modify existing ones
   - Parameters: path (string), content (string)

3. list_files: List files and directories
   - Use this to explore the workspace structure
   - Parameters: path (string) - use "." for the root directory

4. execute_command: Execute a shell command
   - Use this to run build tools, tests, or other commands
   - Parameters: command (string)
   - Note: Commands have a 30-second timeout

TOOL USAGE GUIDELINES:

- Always use read_file before modifying files to understand the current state
- When writing files, preserve existing code structure and style
- Use list_files to explore unfamiliar codebases
- Be cautious with execute_command - explain what you're doing
- All file paths are relative to the workspace root: {{WORKSPACE}}

WORKFLOW BEST PRACTICES:

1. Understand first: Use read_file and list_files to explore
2. Plan changes: Think through modifications before acting
3. Execute carefully: Make targeted changes with write_file
4. Verify: Use execute_command to test changes when appropriate
5. Communicate: Explain your actions to the user

Remember: The user can see your tool usage, so be transparent about what you're doing and why.`;

export function getToolsPrompt(): string {
  return TOOLS_PROMPT;
}
