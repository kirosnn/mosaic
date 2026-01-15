import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const bash: CoreTool = tool({
  description: 'Execute a shell command in the workspace',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
  }),
  execute: async (args) => {
    const result = await executeTool('bash', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});