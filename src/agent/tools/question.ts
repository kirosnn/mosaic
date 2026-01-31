import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { askQuestion } from '../../utils/questionBridge';

export const question: CoreTool = tool({
  description: 'Ask the user a question with predefined options and wait for their selection. The user can select one of the options OR type a custom response directly in the text input field below the options. The returned answer includes: index (selected option index), label (option label), value (option value if set), and customText (if user provided a custom text response).',
  parameters: z.object({
    prompt: z.string().describe('The question to show to the user.'),
    options: z.array(
      z.object({
        label: z.string().describe('The option label shown to the user.'),
        value: z.string().nullable().optional().describe('Optional value returned for the selected option. Use null if not needed.'),
        group: z.string().optional().describe('Optional group name. Consecutive options with the same group are displayed under a shared header.'),
      })
    ).describe('List of options the user can pick from. A text input field is automatically displayed below the options where the user can type a custom response instead.'),
    timeout: z.number().optional().describe('Optional timeout in seconds. The question is automatically rejected when time runs out.'),
    validation: z.object({
      pattern: z.string().describe('Regex pattern the custom text must match.'),
      message: z.string().optional().describe('Error message shown when validation fails.'),
    }).optional().describe('Optional validation for the custom text input.'),
  }),
  execute: async (args) => {
    const answer = await askQuestion(args.prompt, args.options, args.timeout, args.validation);
    return answer;
  },
});