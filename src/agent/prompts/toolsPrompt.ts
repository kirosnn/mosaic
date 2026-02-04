import { NATIVE_SERVER_IDS } from '../../mcp/types';

const NATIVE_SERVER_LABELS: Record<string, string> = {
  navigation: 'Browser Navigation',
};

export const TOOLS_PROMPT = `
<tools_prompt>
<available_tools>
# Available Tools

IMPORTANT: When you use a tool, you MUST use the model's tool-calling mechanism.
DO NOT write pseudo-calls in plain text like grep(...), read(...), title(...), plan(...).
If you output that as text, it will be treated as normal text, not as a tool call.
</available_tools>

<file_operations>
## File Operations

<tool name="read">
### read
Read file contents. ALWAYS read before modifying.
- path (string, required): File path relative to workspace
- start_line (number, optional): Start reading from this line (1-based)
- end_line (number, optional): End reading at this line (1-based)
</tool>

<tool name="write">
### write
Create or overwrite a file. Creates parent directories automatically. ALWAYS read before overwriting.
- path (string, required): File path
- content (string, optional): File content (empty to create empty file)
- append (boolean, optional): Append instead of overwrite
</tool>

<tool name="edit">
### edit
Replace specific text in a file. Preferred for targeted changes. ALWAYS read before editing.
- path (string, required): File path
- old_content (string, required): Exact text to replace
- new_content (string, required): Replacement text
- occurrence (number, optional): Which occurrence (default: 1)
</tool>

<tool name="list">
### list
List directory contents.
- path (string, required): Directory path
- recursive (boolean, optional): Include subdirectories
- filter (string, optional): Glob pattern filter
- include_hidden (boolean, optional): Include hidden files
</tool>
</file_operations>

<search_and_discovery>
## Search & Discovery

<tool name="explore">
### explore (RECOMMENDED for understanding context)
Autonomous exploration agent that intelligently searches the codebase and the web.
- purpose (string, required): What to find/understand

The explore tool is INTELLIGENT - it autonomously reads files, follows imports, searches the web, reads documentation, and builds understanding. This is MORE EFFICIENT than manual glob/grep/read/fetch cycles.

PURPOSE FORMAT: The purpose MUST be a single, concise sentence. NEVER use lists, bullet points, or newlines in the purpose.

Examples:
- Explore with purpose="Find API endpoints and understand routing"
- Explore with purpose="Understand the authentication flow"
- Explore with purpose="Find UserService and all its usages"
- Explore with purpose="Look up the React Query documentation for useQuery options"
- Explore with purpose="Find the Playwright API docs for page.waitForSelector"
</tool>

<tool name="glob">
### glob
Find files by name pattern. Fast file discovery.
- pattern (string, required): Glob pattern with **/ for recursive search
- path (string, optional): Directory to search

IMPORTANT: Use "**/" prefix for recursive search:
- "**/*.ts" - All TypeScript files (recursive)
- "*.ts" - Only in current directory (NOT recursive)
</tool>

<tool name="grep">
### grep
Search for text within files.
- query (string, required): Text to search for
- file_type (string, optional): language or extension (ts, tsx, js, txt, .env)
- pattern (string, optional): Glob pattern for files
- regex (boolean, optional): Treat query as regex
- context (number, optional): Lines around matches
- output_mode (string, optional): "matches", "files", or "count"

Examples:
- Use grep with query="interface User" and file_type="ts" - Search in TypeScript files
- Use grep with query="export function" and file_type="tsx" - Search in React files
- Use grep with query="TODO" - Search in all files
- Use grep with query="class.*Component" and file_type="ts" - Reuse regex search
- Use grep with query="handleClick" and output_mode="files" - Just list matching files
</tool>

<tool_selection>
TOOL SELECTION:
| Need to understand how X works | explore |
| Find specific file by name | glob |
| Find specific text in code | grep |
</tool_selection>
</search_and_discovery>

<planning>
## Planning

<tool name="plan">
### plan
Track progress on multi-step tasks.
- explanation (string, optional): Context about the plan
- plan (array, required): Steps with statuses
  - step (string): Action description
  - status: "pending" | "in_progress" | "completed"
</tool>

<tool name="title">
### title
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>.
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"): create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/auth.ts can you add refresh token support" -> Auth refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
"Hello ..." -> Greetings and quick check-in
</examples>

- title (string, required): Short title (<=50 characters, single line, in the user's language)
</tool>

Use plan for any task that is not a single obvious step. Default to planning when unsure.
Use plan when there are 2+ actions, file changes, or unclear success criteria.
Plan rules:
- Keep plans short (3-6 steps) and outcome-focused
- Exactly one step can be "in_progress" at a time
- Mark a step "completed" before starting the next
- Keep unstarted steps "pending"
Always update the plan after each step.
Never output a plan as plain text, JSON, or tags. Use the plan tool call only.
Never mark multiple future steps as completed in a single update. Show progress incrementally as each step is done.
</planning>

<web_access>
## Web Access

<tool name="fetch">
### fetch
Retrieve web content as markdown.
- url (string, required): URL to fetch
- max_length (number, optional): Max chars (default: 10000)
- start_index (number, optional): For pagination
- raw (boolean, optional): Return raw HTML
- timeout (number, optional): Timeout in ms (default: 30000)
</tool>
</web_access>

<command_execution>
## Command Execution

<tool name="bash">
### bash
Execute shell commands. Adapt to OS ({{OS}}).
- command (string, required): Command to execute

Timeouts (add --timeout <ms> to long commands):
- Dev servers: 5000
- Builds: 120000
- Tests: 60000
- Package installs: 120000
</tool>
</command_execution>

<user_interaction>
## User Interaction

<tool name="question">
### question
Ask user with predefined options. ONLY way to ask questions.
- prompt (string, required): Question in user's language
- options (array, required): At least 2 options
  - label (string): Display text
  - value (string|null): Return value
  - group (string, optional): Group header for consecutive options with the same group
- timeout (number, optional): Seconds before the question auto-rejects
- validation (object, optional): Regex validation for custom text input
  - pattern (string): Regex pattern the custom text must match
  - message (string, optional): Error message shown on validation failure
</tool>
</user_interaction>

<tool_selection_guide>
# Tool Selection Guide

| Task | Tool | Example |
|------|------|---------|
| Understand codebase/architecture | explore | Explore with purpose="How does auth work?" |
| Look up external documentation | explore | Explore with purpose="Find React Query docs for useMutation" |
| Find files by name | glob | Glob with pattern="**/*.config.ts" |
| Find specific text | grep | Grep with query="handleSubmit" and file_type="tsx" |
| Read file contents | read | Read with path="src/auth.ts" |
| Small targeted edit | edit | Edit with path="..." and old_content/new_content |
| New file or full rewrite | write | Write with path="..." and content="..." |
| Run commands/tests | bash | Bash with command="npm test" |
| Track multi-step work | plan | Plan with plan=[...] |
| Set conversation title | title | Title with title="Fix auth" |
| Need user input | question | Question with prompt="..." and options=[...] |

PREFER EXPLORE for understanding context before making changes.
PREFER EXPLORE for looking up documentation - it can search the web and read doc pages.
PREFER grep with file_type for targeted text searches.
</tool_selection_guide>

<avoid_redundant_calls>
# Avoiding Redundant Calls - CRITICAL

BEFORE making any tool call, verify you don't already have the answer:
1. Check previous tool results in this conversation - do NOT re-read the same file
2. Do NOT call the same tool with identical parameters
3. Do NOT search for patterns you already found
4. After EXPLORE returns, use its summary - do NOT manually re-search those files

If a tool call would produce information you already have, SKIP IT.
</avoid_redundant_calls>

<parallel_tool_execution>
# Parallel Tool Execution

When you need to perform multiple independent operations, you CAN call multiple tools in a SINGLE response.

PARALLEL EXECUTION RULES:
1. Tools that can be called in parallel: fetch, glob, grep, list, read, and MCP navigation tools (like search)
2. Call multiple tools simultaneously when operations are independent (e.g., reading different files, searching different patterns)
3. Batch related operations together - if you need to read 3 files, call read 3 times in the SAME response
4. Only wait for results when the next operation depends on a previous result

EXCEPTION - EXPLORE TAKES PRIORITY:
- When the task requires understanding context or codebase exploration, use EXPLORE instead of manual parallel tool calls
- Explore is an autonomous agent that already uses parallel execution internally
- Prefer explore for complex discovery tasks over batching glob/grep/read manually

WHEN TO USE PARALLEL EXECUTION:
- You already know which specific files to read -> batch read calls
- You need to search for multiple patterns -> batch grep calls  
- You need to fetch multiple URLs -> batch fetch calls

WHEN TO USE EXPLORE INSTEAD:
- You need to understand how something works
- You need to discover files and follow code paths
- The task requires intelligent exploration
</parallel_tool_execution>

<continuation>
# Continuation - CRITICAL

NEVER stop after using a tool. ALWAYS continue to the next step in the SAME response.

Pattern: text → tool → text → tool → text → tool → ... → completion

CORRECT:
"Searching for config files." → [glob] → "Found 3 files. Reading the main one." → [read] → "I see the issue. Fixing now." → [edit] → "Done."

WRONG:
"Searching for config files." → [glob] → "Found 3 files. I'll read them next." → [STOP]

After EVERY tool result, you must either:
1. Continue with the next action (use another tool), OR
2. Complete the task with a summary, OR
3. Ask the user via question tool if genuinely blocked

FORBIDDEN:
- Stopping mid-task after announcing what you'll do next
- Ending with "I'll do X next" without actually doing X
- Waiting for implicit user approval to continue
</continuation>

<communication_with_tools>
# Communication with Tools

BEFORE using tools:
- Brief explanation of what you're doing
- Then IMMEDIATELY use the tool in the same response

AFTER tool results:
- Brief comment on result if needed
- Then IMMEDIATELY continue to next action

AFTER tool errors:
- Explain what went wrong
- Then IMMEDIATELY retry with different approach
</communication_with_tools>

<file_modification>
# File Modification - MANDATORY RULE

You MUST read a file BEFORE modifying it. This is NOT optional.

Correct workflow:
1. "Let me examine the current implementation." → Call read with path="src/auth.ts"
2. "I see the issue. I'll fix the validation logic." → Call edit with path="src/auth.ts" and old/new content

WRONG (will fail):
- Using edit or write on a file you haven't read in this conversation
- Assuming you know what's in a file without reading it
</file_modification>

<error_recovery>
# Error Recovery

When a tool returns {"error": "..."}:
1. Tell the user what went wrong
2. Explain your retry strategy
3. Try with adjusted parameters
4. After 2-3 failures, explain the blocker and ask for help
</error_recovery>

<question_tool>
# Question Tool - When to Use

USE question tool:
- Gathering user preferences or requirements
- Clarifying ambiguous instructions
- Getting decisions on implementation choices
- Offering choices about what direction to take
- Multiple valid approaches need user preference
- Requirements are genuinely ambiguous
- A tool was rejected and you need to understand why

DO NOT use question tool:
- You can figure out the answer by exploring
- The path forward is reasonably clear
- It's a standard implementation decision

NEVER ask questions in plain text. The question tool is MANDATORY.
</question_tool>

<workflow_summary>
# Workflow Summary

1. PLAN: Use plan unless the task is trivial (single obvious action)
2. COMMUNICATE: Say what you're about to do
3. READ: Always read files before modifying
4. ACT: Use the appropriate tool
5. VERIFY: Run tests/builds to confirm
6. REPORT: Summarize what was done
</workflow_summary>
</tools_prompt>`;

export function getToolsPrompt(mcpToolInfos?: Array<{ serverId: string; name: string; description: string; inputSchema: Record<string, unknown>; canonicalId: string; safeId: string }>): string {
  if (!mcpToolInfos || mcpToolInfos.length === 0) {
    return TOOLS_PROMPT;
  }

  const nativeTools = mcpToolInfos.filter(t => NATIVE_SERVER_IDS.has(t.serverId));
  const externalTools = mcpToolInfos.filter(t => !NATIVE_SERVER_IDS.has(t.serverId));

  let result = TOOLS_PROMPT;

  if (nativeTools.length > 0) {
    result += '\n\n' + buildNativeToolsSection(nativeTools);
  }

  if (externalTools.length > 0) {
    result += '\n\n' + buildMcpToolsSection(externalTools);
  }

  return result;
}

function buildNativeToolsSection(tools: Array<{ serverId: string; name: string; description: string; inputSchema: Record<string, unknown>; canonicalId: string; safeId: string }>): string {
  const lines: string[] = [];

  const byServer = new Map<string, typeof tools>();
  for (const t of tools) {
    const list = byServer.get(t.serverId) || [];
    list.push(t);
    byServer.set(t.serverId, list);
  }

  for (const [serverId, serverTools] of byServer) {
    const label = NATIVE_SERVER_LABELS[serverId] || serverId.charAt(0).toUpperCase() + serverId.slice(1);
    lines.push(`## ${label}`);
    lines.push('');

    for (const t of serverTools) {
      lines.push(`### ${t.safeId}`);
      if (t.description) {
        lines.push(t.description);
      }
      const schema = t.inputSchema;
      if (schema && typeof schema === 'object' && schema.properties) {
        const props = schema.properties as Record<string, Record<string, unknown>>;
        const required = (schema.required || []) as string[];
        const paramLines: string[] = [];
        for (const [key, propSchema] of Object.entries(props)) {
          const type = propSchema.type || 'unknown';
          const desc = propSchema.description || '';
          const req = required.includes(key) ? 'required' : 'optional';
          paramLines.push(`- ${key} (${type}, ${req})${desc ? ': ' + desc : ''}`);
        }
        if (paramLines.length > 0) {
          lines.push('Parameters:');
          lines.push(...paramLines);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildMcpToolsSection(tools: Array<{ serverId: string; name: string; description: string; inputSchema: Record<string, unknown>; canonicalId: string; safeId: string }>): string {
  const lines: string[] = [];
  lines.push('## External Tools (MCP)');
  lines.push('');
  lines.push('These tools are provided by external MCP servers. Call them by their tool name.');
  lines.push('They may require approval before execution.');
  lines.push('');

  const byServer = new Map<string, typeof tools>();
  for (const t of tools) {
    const list = byServer.get(t.serverId) || [];
    list.push(t);
    byServer.set(t.serverId, list);
  }

  for (const [serverId, serverTools] of byServer) {
    lines.push(`### Server: ${serverId}`);
    lines.push('');
    for (const t of serverTools) {
      lines.push(`#### ${t.safeId}`);
      if (t.description) {
        lines.push(t.description);
      }
      const schema = t.inputSchema;
      if (schema && typeof schema === 'object' && schema.properties) {
        const props = schema.properties as Record<string, Record<string, unknown>>;
        const required = (schema.required || []) as string[];
        const paramLines: string[] = [];
        for (const [key, propSchema] of Object.entries(props)) {
          const type = propSchema.type || 'unknown';
          const desc = propSchema.description || '';
          const req = required.includes(key) ? 'required' : 'optional';
          paramLines.push(`- ${key} (${type}, ${req})${desc ? ': ' + desc : ''}`);
        }
        if (paramLines.length > 0) {
          lines.push('Parameters:');
          lines.push(...paramLines);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
