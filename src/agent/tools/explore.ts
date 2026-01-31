import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { executeExploreTool } from './exploreExecutor';

export const explore: CoreTool = tool({
  description: `Explore the codebase and web autonomously to gather information.
This tool launches an exploration agent that will use read, glob, grep, list, fetch, and search tools iteratively.
The agent can search the web for documentation and fetch web pages when needed.
Use this for open-ended exploration tasks like understanding code structure, finding implementations, looking up documentation, etc.`,
  parameters: z.object({
    purpose: z.string().describe('The goal of the exploration - what information you need to gather'),
  }),
  execute: async (args) => {
    const result = await executeExploreTool(args.purpose);
    if (!result.success) return { error: result.error || 'Unknown error occurred' };
    return result.result;
  },
});
