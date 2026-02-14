import type { Command, SelectOption } from './types';
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
      const options: SelectOption[] = providers.map(p => {
        const hasKey = getApiKeyForProvider(p.id);
        const isActive = p.id === config.provider;
        const isDisabled = p.requiresApiKey && !hasKey;

        let description = p.name;
        if (p.requiresApiKey) {
          description += hasKey ? ' [key set]' : ' [no key]';
        }

        const popular = ['openai', 'anthropic', 'google'];
        const category = popular.includes(p.id) ? 'Popular' : 'Other';

        return {
          name: p.id,
          description,
          value: p.id,
          active: isActive,
          disabled: isDisabled,
          category,
          badge: isActive ? 'Connected' : undefined,
        };
      }).sort((a, b) => {
        if (a.category === b.category) return 0;
        return a.category === 'Popular' ? -1 : 1;
      });

      return {
        success: true,
        content: '',
        showSelectMenu: {
          title: 'Select AI Provider',
          options,
          onSelect: (value: string) => {
            const provider = getProviderById(value);
            if (!provider) return;

            if (provider.id === config.provider) return;

            setActiveProvider(provider.id);

            const currentModel = config.model;
            const modelExists = provider.models.some(m => m.id === currentModel);

            if (!modelExists && provider.models.length > 0) {
              const firstModel = provider.models[0]!;
              setActiveModel(firstModel.id);
            }
          },
        },
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
