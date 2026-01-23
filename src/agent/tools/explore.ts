import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeTool } from './executor';

const ALLOWED_TOOLS = ['read', 'glob', 'grep', 'list'] as const;
type AllowedTool = typeof ALLOWED_TOOLS[number];

const toolCallSchema = z.object({
  tool: z.enum(ALLOWED_TOOLS).describe('The tool to execute'),
  args: z.record(z.unknown()).describe('Arguments to pass to the tool'),
});

export const explore: CoreTool = tool({
  description: `Execute multiple read-only tools in parallel for faster exploration.
Only allows safe tools: ${ALLOWED_TOOLS.join(', ')}.
Use this to speed up exploration by running multiple searches/reads at once.
Each tool call will be executed simultaneously and results returned together.`,
  parameters: z.object({
    calls: z.array(toolCallSchema)
      .min(1)
      .max(10)
      .describe('Array of tool calls to execute in parallel. Each call specifies a tool name and its arguments.'),
  }),
  execute: async (args) => {
    const result = await executeTool('explore', args);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
