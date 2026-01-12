import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const execute_command: CoreTool = tool({
  description: 'Execute a shell command in the workspace',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async (args) => {
    const result = await executeTool('execute_command', args);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result;
  },
});