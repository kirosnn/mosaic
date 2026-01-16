import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

export const write: CoreTool = tool({
  description: 'Write or overwrite a file in the workspace. Creates parent directories automatically if they do not exist. IMPORTANT: This operation requires user approval - the user will see a preview and must approve before the file is written. If rejected, ask the user for clarification using the question tool.',
  parameters: z.object({
    path: z.string().describe('The path to the file relative to the workspace root'),
    content: z.string().nullable().optional().transform((v) => v ?? '').describe('The content to write to the file (use null for empty string)'),
    append: z.boolean().nullable().optional().transform((v) => v ?? false).describe('If true, append to the file instead of overwriting (use null for false)'),
  }),
  execute: async (args) => {
    const result = await executeTool('write', args);
    if (!result.success) {
      return result.userMessage
        ? { error: result.error, userMessage: result.userMessage }
        : { error: result.error };
    }
    return result.result;
  },
});