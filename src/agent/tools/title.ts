import { tool, type CoreTool } from 'ai';
import { z } from 'zod';

export const title: CoreTool = tool({
  description: "Set a short title for the current conversation/task (<=50 characters, single line, in the user's language).",
  parameters: z.object({
    title: z.string().describe("Short title (<=50 characters, single line, in the user's language)."),
  }),
  execute: async (args) => {
    const raw = typeof (args as any).title === 'string' ? (args as any).title : '';
    const normalized = raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const limited = normalized.length > 50 ? normalized.slice(0, 50).trimEnd() : normalized;
    return { title: limited };
  },
});
