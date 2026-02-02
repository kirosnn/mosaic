import { tool, type CoreTool } from 'ai';
import { z } from 'zod';

export const title: CoreTool = tool({
  description: "Set a short title for the current conversation/task (max 6 words, in the user's language).",
  parameters: z.object({
    title: z.string().describe("Short title (max 6 words, in the user's language)."),
  }),
  execute: async (args) => {
    const raw = typeof (args as any).title === 'string' ? (args as any).title : '';
    const normalized = raw.replace(/[\r\n]+/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    const limited = words.slice(0, 6).join(' ');
    return { title: limited };
  },
});
