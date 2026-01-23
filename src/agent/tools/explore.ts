import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeExploreTool } from './exploreExecutor';

export const explore: CoreTool = tool({
  description: `Explore the codebase autonomously to gather information.
This tool launches an exploration agent that will use read, glob, grep, and list tools iteratively.
The agent will continue exploring until it has gathered enough information to answer the purpose.
Use this for open-ended exploration tasks like understanding code structure, finding implementations, etc.`,
  parameters: z.object({
    purpose: z.string().describe('The goal of the exploration - what information you need to gather'),
  }),
  execute: async (args) => {
    const result = await executeExploreTool(args.purpose);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
