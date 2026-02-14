import type { Command, SelectOption } from './types';
import { readConfig, getProviderById, setActiveModel } from '../config';

export const modelCommand: Command = {
  name: 'model',
  description: 'List or switch AI models for the current provider',
  usage: '/model [id]',
  aliases: ['mod'],
  execute: (args: string[]) => {
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
      if (provider.models.length === 0) {
        return {
          success: true,
          content: `No models available for ${provider.name}.`,
        };
      }

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
            setActiveModel(value);
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
