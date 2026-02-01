import type { Command } from './types';
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

      const lines = provider.models.map(m => {
        const active = m.id === config.model ? ' (active)' : '';
        return `  ${m.id} - ${m.name}${active}`;
      });

      const currentInList = provider.models.some(m => m.id === config.model);
      const extra = !currentInList && config.model
        ? `\n\n  Current model: ${config.model} (custom)`
        : '';

      return {
        success: true,
        content: `Models for ${provider.name}:\n\n${lines.join('\n')}${extra}`,
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
