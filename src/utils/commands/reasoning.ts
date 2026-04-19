import type { Command, SelectOption } from './types';
import { supportsReasoningEffort } from '../../agent/provider/reasoning';
import {
  clearModelReasoningEffort,
  getAvailableReasoningEfforts,
  getCodexModelReasoningEffort,
  getDefaultModelReasoningEffort,
  getModelReasoningEffort,
  getModelReasoningEffortSource,
  readConfig,
  setModelReasoningEffort,
  type ReasoningEffort,
} from '../config';

function buildReasoningMessage(): string {
  const effective = getModelReasoningEffort();
  const source = getModelReasoningEffortSource();
  if (source === 'mosaic') {
    return `Thinking effort set to ${effective}.`;
  }
  if (source === 'codex') {
    return `Thinking effort inherited from Codex: ${effective}.`;
  }
  return `Thinking effort set to default: ${effective}.`;
}

function buildOptions(providerId?: string, modelId?: string): SelectOption[] {
  const effective = getModelReasoningEffort();
  const source = getModelReasoningEffortSource();
  const codex = getCodexModelReasoningEffort();
  const fallback = getDefaultModelReasoningEffort();

  const options: SelectOption[] = [
    {
      name: `default`,
      description: codex ? `Use Codex local setting (${codex})` : `Use Mosaic default (${fallback})`,
      value: 'default',
      active: source !== 'mosaic',
      badge: source !== 'mosaic' ? 'Active' : undefined,
    },
  ];

  for (const effort of getAvailableReasoningEfforts(providerId, modelId)) {
    options.push({
      name: effort,
      description: effort === effective && source === 'mosaic' ? 'Current custom effort' : 'Set this thinking effort',
      value: effort,
      active: source === 'mosaic' && effort === effective,
      badge: source === 'mosaic' && effort === effective ? 'Active' : undefined,
    });
  }

  return options;
}

function isReasoningEffort(value: string, providerId?: string, modelId?: string): value is ReasoningEffort {
  return getAvailableReasoningEfforts(providerId, modelId).includes(value as ReasoningEffort);
}

export const reasoningCommand: Command = {
  name: 'reasoning',
  description: 'Show or change the thinking effort',
  usage: '/reasoning [low|medium|high|xhigh|default]',
  aliases: ['effort'],
  execute: async (args: string[], _fullCommand: string, _context?: any) => {
    const config = readConfig();
    const providerId = config.provider;
    const modelId = config.model;

    if (!providerId || !modelId) {
      return {
        success: false,
        content: 'No provider or model configured. Use /provider and /model first.',
      };
    }

    const reasoningSupported = await supportsReasoningEffort(providerId, modelId);
    if (!reasoningSupported) {
      return {
        success: false,
        content: `Thinking effort configuration is not supported by the current model (${modelId}).`,
      };
    }

    if (args.length === 0) {
      return {
        success: true,
        content: buildReasoningMessage(),
        showSelectMenu: {
          title: `Thinking Effort for ${modelId}`,
          options: buildOptions(providerId, modelId),
          onSelect: (value: string) => {
            if (value === 'default') {
              clearModelReasoningEffort();
              return;
            }
            if (isReasoningEffort(value, providerId, modelId)) {
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

    if (!isReasoningEffort(value, providerId, modelId)) {
      return {
        success: false,
        content: `Unknown reasoning effort "${value}". Available for this model: ${getAvailableReasoningEfforts(providerId, modelId).join(', ')}, default.`,
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
