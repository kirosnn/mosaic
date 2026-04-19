import type { Command, SelectOption } from './types';
import { supportsReasoningEffort } from '../../agent/provider/reasoning';
import {
  clearModelReasoningEffort,
  getAvailableReasoningEfforts,
  getCodexModelReasoningEffort,
  getDefaultModelReasoningEffort,
  getModelReasoningEffort,
  getModelReasoningEffortSource,
  getProviderById,
  normalizeModelForProvider,
  readConfig,
  setActiveModel,
  setModelReasoningEffort,
  type ReasoningEffort,
} from '../config';

function isReasoningEffort(value: string, providerId?: string, modelId?: string): value is ReasoningEffort {
  return getAvailableReasoningEfforts(providerId, modelId).includes(value as ReasoningEffort);
}

function buildReasoningOptions(providerId?: string, modelId?: string): SelectOption[] {
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
      description: effort === effective && source === 'mosaic' ? 'Current custom effort' : 'Set this reasoning effort',
      value: effort,
      active: source === 'mosaic' && effort === effective,
      badge: source === 'mosaic' && effort === effective ? 'Active' : undefined,
    });
  }

  return options;
}

export const modelCommand: Command = {
  name: 'model',
  description: 'List or switch AI models for the current provider',
  usage: '/model [id]',
  aliases: ['mod'],
  execute: async (args: string[], _fullCommand: string, _context?: any) => {
    const config = readConfig();

    if (!config.provider) {
      return {
        success: false,
        content: 'No provider configured. Use /provider to set one first.',
      };
    }

    const provider = getProviderById(config.provider);

    if (!provider) {
      return {
        success: false,
        content: `Provider "${config.provider}" not found.`,
      };
    }

    if (args.length === 0) {
      const normalizedCurrentModel = normalizeModelForProvider(config.provider, config.model);
      if (normalizedCurrentModel && normalizedCurrentModel !== config.model) {
        setActiveModel(normalizedCurrentModel);
        config.model = normalizedCurrentModel;
      }

      if (provider.models.length === 0) {
        return {
          success: true,
          content: `No models available for ${provider.name}.`,
        };
      }

      const modelsToProbe = provider.models.map(model => model.id);
      if (config.model && !modelsToProbe.includes(config.model)) {
        modelsToProbe.unshift(config.model);
      }

      const reasoningSupportEntries = await Promise.all(
        modelsToProbe.map(async (modelId) => {
          try {
            return [modelId, await supportsReasoningEffort(provider.id, modelId)] as const;
          } catch {
            return [modelId, false] as const;
          }
        })
      );
      const reasoningSupport = new Map<string, boolean>(reasoningSupportEntries);

      const options: SelectOption[] = provider.models.map(m => {
        const isActive = m.id === config.model;
        return {
          name: m.id,
          description: m.name,
          value: m.id,
          active: isActive,
          disabled: false,
          badge: isActive ? '' : undefined,
        };
      });

      const currentInList = provider.models.some(m => m.id === config.model);
      if (!currentInList && config.model) {
        options.unshift({
          name: config.model,
          description: '(custom model)',
          value: config.model,
          active: true,
          disabled: false,
        });
      }

      return {
        success: true,
        content: '',
        showSelectMenu: {
          title: `Select Model for ${provider.name}`,
          options,
          onSelect: (value: string) => {
            const chosenModel = provider.models.find(model => model.id === value);
            if (!reasoningSupport.get(value)) {
              setActiveModel(value);
              return {
                confirmationMessage: `Model set to ${chosenModel ? `${chosenModel.name} (${value})` : value}.`,
              };
            }
            return {
              nextMenu: {
                title: `Reasoning Effort for ${chosenModel?.name ?? value}`,
                options: buildReasoningOptions(provider.id, value),
                onSelect: (reasoningValue: string) => {
                  setActiveModel(value);
                  if (reasoningValue === 'default') {
                    clearModelReasoningEffort();
                  } else if (isReasoningEffort(reasoningValue, provider.id, value)) {
                    setModelReasoningEffort(reasoningValue);
                  }
                  const reasoningLabel =
                    reasoningValue === 'default'
                      ? `default (${getDefaultModelReasoningEffort()})`
                      : reasoningValue;
                  return {
                    confirmationMessage: `Model set to ${chosenModel ? `${chosenModel.name} (${value})` : value}. Reasoning effort set to ${reasoningLabel}.`,
                  };
                },
              },
              closeMenu: false,
              confirmationMessage: null,
            };
          },
        },
      };
    }

    const targetId = args[0]!;
    setActiveModel(targetId);

    const knownModel = provider.models.find(m => m.id === targetId);
    const label = knownModel ? `${knownModel.name} (${targetId})` : targetId;

    return {
      success: true,
      content: `Model set to ${label}.`,
    };
  },
};
