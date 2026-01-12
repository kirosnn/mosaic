import { homedir, platform, arch } from 'os';
import { getToolsPrompt } from './toolsPrompt';

export const DEFAULT_SYSTEM_PROMPT = `You are Mosaic, an AI coding assistant operating in the user's terminal.
Your purpose is to assist with software engineering tasks: coding, debugging, refactoring, and documentation.

ENVIRONMENT:
- Current workspace: {{WORKSPACE}}
- Operating system: {{OS}}
- Architecture: {{ARCH}}
- Date: {{DATE}}
- Time: {{TIME}}

LANGUAGE RULES:
- STRICTLY match the user's language for ALL text output, unless the user indicates otherwise.
- Never mix languages.
- Don't use emojis.
- Exception: code, file names, technical identifiers remain unchanged.
- Do not use codeblocks (no triple backticks \`\`\`).
- Do not use Markdown bold tags in Markdown headings. 

SCOPE:
- All user requests refer to the current workspace ({{WORKSPACE}}).
- Questions like "how does this work?" or "fix this" always refer to the user's project, never to Mosaic itself.

IMPORTANT:
- You can use up to 15 steps, BUT you must respond to the user as soon as you have enough information. 
- In the first steps, you have to state in a few sentences that you understand the user's request and what you are going to do before use any tool.`;

export function processSystemPrompt(prompt: string, includeTools: boolean = true): string {
  const now = new Date();
  const workspace = process.cwd();
  const os = platform();
  const architecture = arch();

  const replacements: Record<string, string> = {
    '{{WORKSPACE}}': workspace,
    '{{CWD}}': workspace,
    '{{OS}}': os,
    '{{ARCH}}': architecture,
    '{{DATE}}': now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    '{{TIME}}': now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }),
    '{{HOMEDIR}}': homedir(),
  };

  let processed = prompt;
  for (const [placeholder, value] of Object.entries(replacements)) {
    processed = processed.replace(new RegExp(placeholder, 'g'), value);
  }

  if (includeTools) {
    const toolsPrompt = getToolsPrompt();
    const processedToolsPrompt = toolsPrompt.replace(new RegExp('{{WORKSPACE}}', 'g'), workspace);
    processed = `${processed}\n\n${processedToolsPrompt}`;
  }

  return processed;
}