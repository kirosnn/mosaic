import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';
import { trackMutation } from './toolCallTracker';

export const bash: CoreTool = tool({
  description: 'Execute a shell command in the workspace. Add --timeout <ms> at the END of your command for long-running processes (max 90000ms). IMPORTANT: This operation requires user approval - the user will see the command that will be executed and must approve before it runs. If rejected, ask the user for clarification using the question tool.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute. Add --timeout <ms> at the end (max 90000ms) for: dev servers (--timeout 5000), builds (--timeout 90000), tests (--timeout 60000), installs (--timeout 90000), interactive CLIs with menus/options (--timeout 5000). You will receive the command output and must analyze it to determine if it succeeded or failed.'),
  }),
  execute: async (args) => {
    const result = await executeTool('bash', args);
    if (!result.success) {
      const errorMessage = result.error || result.result || 'Unknown error occurred';
      return result.userMessage
        ? { error: errorMessage, userMessage: result.userMessage }
        : { error: errorMessage };
    }
    trackMutation();
    return result.result;
  },
});
