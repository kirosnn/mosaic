import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { askQuestion } from '../../utils/questionBridge';

export const question: CoreTool = tool({
  description: 'Ask the user a question with predefined options and wait for their selection.',
  parameters: z.object({
    prompt: z.string().describe('The question to show to the user.'),
    options: z.array(
      z.object({
        label: z.string().describe('The option label shown to the user.'),
        value: z.string().nullable().optional().describe('Optional value returned for the selected option. Use null if not needed.'),
      })
    ).describe('List of options the user can pick from.'),
  }),
  execute: async (args) => {
    const answer = await askQuestion(args.prompt, args.options);
    return answer;
  },
});