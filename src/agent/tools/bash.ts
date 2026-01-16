import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const bash: CoreTool = tool({
  description: 'Execute a shell command in the workspace. IMPORTANT: This operation requires user approval - the user will see the command that will be executed and must approve before it runs. If rejected, ask the user for clarification using the question tool.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async (args) => {
    const result = await executeTool('bash', args);
    if (!result.success) {
      const errorMessage = result.error || 'Unknown error occurred';
      return result.userMessage
        ? { error: errorMessage, userMessage: result.userMessage }
        : { error: errorMessage };
    }
    return result.result;
  },
});