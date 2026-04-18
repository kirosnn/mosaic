import type { Command, SelectOption } from './types';
import {
  clearLightweightRoute,
  getAllProviders,
  getAuthForProvider,
  getConfiguredLightweightRouteSelection,
  getLightweightRoute,
  readConfig,
  setLightweightRoute,
} from '../config';

function buildProviderOptions() {
  const config = readConfig();
  const providers = getAllProviders();
  const configuredRoute = getConfiguredLightweightRouteSelection({ config });
  const fallbackRoute = getLightweightRoute(config.provider ?? '', config.model, { config });

  const options: SelectOption[] = [
    {
      name: 'default',
      description: `Use the active provider lightweight route (${fallbackRoute.providerId} / ${fallbackRoute.modelId})`,
      value: '__default__',
      active: !configuredRoute,
      badge: !configuredRoute ? 'Selected' : undefined,
      category: 'Mode',
    },
  ];

  for (const provider of providers) {
    const auth = getAuthForProvider(provider.id);
    const isSelected = configuredRoute?.providerId === provider.id;
    const authLabel = provider.requiresApiKey
      ? auth ? '[connected]' : '[not connected]'
      : auth?.type === 'oauth' ? '[oauth]' : '[ready]';

    options.push({
      name: provider.id,
      description: `${provider.name} ${authLabel}`.trim(),
      value: provider.id,
      active: isSelected,
      disabled: !auth && provider.requiresApiKey,
      category: provider.id === 'openai' || provider.id === 'anthropic' || provider.id === 'google' ? 'Popular' : 'Other',
      badge: isSelected ? 'Selected' : undefined,
    });
  }

  return options;
}

function buildModelOptions(providerId: string): SelectOption[] {
  const config = readConfig();
  const provider = getAllProviders().find(entry => entry.id === providerId);
  const configuredRoute = getConfiguredLightweightRouteSelection({ config });

  if (!provider) {
    return [];
  }

  return provider.models.map(model => ({
    name: model.id,
    description: model.name,
    value: model.id,
    active: configuredRoute?.providerId === providerId && configuredRoute.modelId === model.id,
    badge: configuredRoute?.providerId === providerId && configuredRoute.modelId === model.id ? 'Selected' : undefined,
  }));
}

export const lightweightCommand: Command = {
  name: 'lightweight',
  description: 'Configure the lightweight provider/model used for chat and intent routing',
  usage: '/lightweight',
  aliases: ['lite', 'duo'],
  execute: async (args: string[]) => {
    const config = readConfig();

    if (!config.provider || !config.model) {
      return {
        success: false,
        content: 'No provider configured. Use /provider and /model first.',
      };
    }

    if (args.length > 0) {
      const action = args[0]!.toLowerCase();
      if (action === 'default' || action === 'reset' || action === 'clear') {
        clearLightweightRoute();
        const fallback = getLightweightRoute(config.provider, config.model);
        return {
          success: true,
          content: `Lightweight routing reset to the active provider defaults (${fallback.providerId} / ${fallback.modelId}).`,
        };
      }

      return {
        success: false,
        content: 'Usage: /lightweight or /lightweight reset',
      };
    }

    return {
      success: true,
      content: '',
      showSelectMenu: {
        title: 'Select Lightweight Provider',
        options: buildProviderOptions(),
        onSelect: (providerId: string) => {
          if (providerId === '__default__') {
            clearLightweightRoute();
            const fallback = getLightweightRoute(config.provider!, config.model!);
            return {
              confirmationMessage: `Lightweight routing reset to the active provider defaults (${fallback.providerId} / ${fallback.modelId}).`,
            };
          }

          const provider = getAllProviders().find(entry => entry.id === providerId);
          if (!provider) {
            return {
              confirmationMessage: `Unknown provider: ${providerId}.`,
            };
          }

          return {
            nextMenu: {
              title: `Select Lightweight Model for ${provider.name}`,
              options: buildModelOptions(providerId),
              onSelect: (modelId: string) => {
                setLightweightRoute(providerId, modelId);
                const model = provider.models.find(entry => entry.id === modelId);
                return {
                  confirmationMessage: `Lightweight routing set to ${provider.name} / ${model?.name ?? modelId} (${modelId}).`,
                };
              },
            },
            closeMenu: false,
            confirmationMessage: null,
          };
        },
      },
    };
  },
};
