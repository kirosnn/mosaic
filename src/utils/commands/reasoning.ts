import type { Command, SelectOption } from './types';
import {
  clearModelReasoningEffort,
  getAvailableReasoningEfforts,
  getCodexModelReasoningEffort,
  getDefaultModelReasoningEffort,
  getModelReasoningEffort,
  getModelReasoningEffortSource,
  setModelReasoningEffort,
  type ReasoningEffort,
} from '../config';

function buildReasoningMessage(): string {
  const effective = getModelReasoningEffort();
  const source = getModelReasoningEffortSource();
  if (source === 'mosaic') {
    return `Reasoning effort set to ${effective}.`;
  }
  if (source === 'codex') {
    return `Reasoning effort inherited from Codex: ${effective}.`;
  }
  return `Reasoning effort set to default: ${effective}.`;
}

function buildOptions(): SelectOption[] {
  const effective = getModelReasoningEffort();
  const source = getModelReasoningEffortSource();
  const codex = getCodexModelReasoningEffort();
  const fallback = getDefaultModelReasoningEffort();

  const options: SelectOption[] = [
    {
      name: `Default (${codex ? `Codex: ${codex}` : fallback})`,
      description: codex ? 'Use the same effort as local Codex on this PC' : 'Use the built-in default effort',
      value: 'default',
      active: source !== 'mosaic',
      badge: source !== 'mosaic' ? 'Active' : undefined,
    },
  ];

  for (const effort of getAvailableReasoningEfforts()) {
    options.push({
      name: effort,
      description: effort === effective && source === 'mosaic' ? 'Current custom effort' : 'Set this reasoning effort',
      value: effort,
      active: source === 'mosaic' && effort === effective,
      badge: source === 'mosaic' && effort === effective ? 'Active' : undefined,
    });
  }

  return options;
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return getAvailableReasoningEfforts().includes(value as ReasoningEffort);
}

export const reasoningCommand: Command = {
  name: 'reasoning',
  description: 'Show or change the reasoning effort',
  usage: '/reasoning [low|medium|high|xhigh|default]',
  aliases: ['effort'],
  execute: (args: string[]) => {
    if (args.length === 0) {
      return {
        success: true,
        content: buildReasoningMessage(),
        showSelectMenu: {
          title: 'Select Reasoning Effort',
          options: buildOptions(),
          onSelect: (value: string) => {
            if (value === 'default') {
              clearModelReasoningEffort();
              return;
            }
            if (isReasoningEffort(value)) {
              setModelReasoningEffort(value);
            }
          },
        },
      };
    }

    const value = args[0]!.trim().toLowerCase();
    if (value === 'default' || value === 'reset') {
      clearModelReasoningEffort();
      return {
        success: true,
        content: buildReasoningMessage(),
      };
    }

    if (!isReasoningEffort(value)) {
      return {
        success: false,
        content: `Unknown reasoning effort "${value}". Available: ${getAvailableReasoningEfforts().join(', ')}, default.`,
        shouldAddToHistory: false,
      };
    }

    setModelReasoningEffort(value);
    return {
      success: true,
      content: buildReasoningMessage(),
    };
  },
};
