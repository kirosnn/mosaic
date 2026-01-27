import { tool, type CoreTool } from 'ai';
import { z } from 'zod';

const PlanStepSchema = z.object({
  step: z.string().describe('A short, specific action item.'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status of the step.'),
});

export const plan: CoreTool = tool({
  description: 'Create or update a task plan for longer work, and keep it up to date as you progress. Update the plan after each step.',
  parameters: z.object({
    explanation: z.string().optional().describe('Optional context about the plan or changes.'),
    plan: z.array(PlanStepSchema).min(1).describe('Ordered list of steps with statuses.'),
  }),
  execute: async (args) => {
    const rawPlan = Array.isArray(args.plan) ? args.plan : [];
    const normalizedPlan = rawPlan
      .map((item) => ({
        step: typeof item.step === 'string' ? item.step : '',
        status: item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending',
      }))
      .filter((item) => item.step.trim().length > 0);

    const explanation = typeof args.explanation === 'string' ? args.explanation : undefined;
    return { explanation, plan: normalizedPlan };
  },
});
