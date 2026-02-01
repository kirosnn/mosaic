import type { Command } from './types';
import {
  readConfig,
  getAllProviders,
  getProviderById,
  getApiKeyForProvider,
  setActiveProvider,
  setActiveModel,
} from '../config';

export const providerCommand: Command = {
  name: 'provider',
  description: 'List or switch AI providers',
  usage: '/provider [name]',
  aliases: ['prov'],
  execute: (args: string[]) => {
    const config = readConfig();
    const providers = getAllProviders();

    if (args.length === 0) {
      const lines = providers.map(p => {
        const active = p.id === config.provider ? ' (active)' : '';
        const hasKey = getApiKeyForProvider(p.id) ? ' [key set]' : (p.requiresApiKey ? ' [no key]' : '');
        return `  ${p.id} - ${p.name}${active}${hasKey}`;
      });

      return {
        success: true,
        content: `Available providers:\n\n${lines.join('\n')}`,
      };
    }

    const target = args[0]!.toLowerCase();
    const provider = getProviderById(target);

    if (!provider) {
      const available = providers.map(p => p.id).join(', ');
      return {
        success: false,
        content: `Unknown provider "${target}". Available: ${available}`,
      };
    }

    if (provider.id === config.provider) {
      return {
        success: true,
        content: `Already using ${provider.name}.`,
      };
    }

    setActiveProvider(provider.id);

    const currentModel = config.model;
    const modelExists = provider.models.some(m => m.id === currentModel);

    if (!modelExists && provider.models.length > 0) {
      const firstModel = provider.models[0]!;
      setActiveModel(firstModel.id);
      return {
        success: true,
        content: `Switched to ${provider.name}. Model set to ${firstModel.name} (${firstModel.id}).`,
      };
    }

    return {
      success: true,
      content: `Switched to ${provider.name}.`,
    };
  },
};
