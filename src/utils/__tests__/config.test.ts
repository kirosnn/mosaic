import { describe, expect, it } from 'bun:test';
import { getConfiguredLightweightRouteSelection, getLightweightModelForProvider, getLightweightRoute, getMistralAuthMode, isSupportedOpenAIOAuthCatalogModelId, sanitizeOpenAIOAuthCatalogModels, type AIModel } from '../config';

describe('OpenAI OAuth model catalog', () => {
  it('accepts only the supported ChatGPT OAuth models', () => {
    expect(isSupportedOpenAIOAuthCatalogModelId('codex-auto-review')).toBe(true);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.2')).toBe(true);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.3-codex')).toBe(true);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.4')).toBe(true);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.4-mini')).toBe(true);

    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-4.1-2025-04-14')).toBe(false);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5-2025-08-07')).toBe(false);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.4-2026-03-25')).toBe(false);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.1-codex-max')).toBe(false);
    expect(isSupportedOpenAIOAuthCatalogModelId('gpt-5.2-codex')).toBe(false);
    expect(isSupportedOpenAIOAuthCatalogModelId('codex-mini-latest')).toBe(false);
  });

  it('sanitizes stale OpenAI OAuth model lists before they reach the selector', () => {
    const input: AIModel[] = [
      { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', description: 'Classic API model' },
      { id: 'gpt-5.4', name: 'GPT-5.4', description: 'OAuth model' },
      { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', description: 'Unsupported OAuth model' },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', description: 'OAuth model' },
    ];

    expect(sanitizeOpenAIOAuthCatalogModels(input).map(model => model.id)).toEqual([
      'gpt-5.4',
      'gpt-5.3-codex',
    ]);
  });

  it('selects a lightweight provider model and prefers the OpenAI OAuth mini model', () => {
    expect(getLightweightModelForProvider('anthropic', 'claude-opus-4-5')).toBe('claude-haiku-4-5');
    expect(getLightweightModelForProvider('google', 'gemini-2.5-pro')).toBe('gemini-3-flash-preview');
    expect(getLightweightModelForProvider('groq', 'llama-3.3-70b-versatile')).toBe('llama-3.1-8b-instant');

    expect(getLightweightModelForProvider('openai-oauth', 'gpt-5.4', {
      config: {
      firstRun: false,
      version: 'test',
      provider: 'openai-oauth',
      model: 'gpt-5.4',
      oauthTokens: {
        openai: {
          accessToken: 'test-token',
        },
      },
      oauthModels: {
        openai: [
          { id: 'gpt-5.4', name: 'GPT-5.4', description: 'OAuth model' },
          { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'OAuth model' },
        ],
      },
    },
    })).toBe('gpt-5.4-mini');
  });

  it('allows overriding lightweight routing with a provider/model duo', () => {
    const config = {
      firstRun: false,
      version: 'test',
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      apiKeys: {
        anthropic: 'anthropic-key',
        openai: 'openai-key',
      },
      lightweightRoute: {
        provider: 'openai',
        model: 'gpt-4.1-2025-04-14',
      },
    };

    expect(getConfiguredLightweightRouteSelection({ config })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4.1-2025-04-14',
      source: 'configured',
    });
    expect(getLightweightRoute('anthropic', 'claude-opus-4-5', { config })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4.1-2025-04-14',
      source: 'configured',
    });
  });

  it('falls back to the active provider default when the configured duo is invalid', () => {
    const config = {
      firstRun: false,
      version: 'test',
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      apiKeys: {
        anthropic: 'anthropic-key',
      },
      lightweightRoute: {
        provider: 'openai',
        model: 'gpt-4.1-2025-04-14',
      },
    };

    expect(getConfiguredLightweightRouteSelection({ config })).toBeUndefined();
    expect(getLightweightRoute('anthropic', 'claude-opus-4-5', { config })).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      source: 'provider_default',
    });
  });

  it('routes mistral lightweight requests to codestral when the auth mode is codestral-only', () => {
    const config = {
      firstRun: false,
      version: 'test',
      provider: 'mistral',
      model: 'mistral-large-latest',
      mistralAuthMode: 'codestral-only' as const,
      apiKeys: {
        mistral: 'codestral-key',
      },
    };

    expect(getMistralAuthMode(config)).toBe('codestral-only');
    expect(getLightweightRoute('mistral', 'mistral-large-latest', { config })).toEqual({
      providerId: 'mistral',
      modelId: 'codestral-latest',
      source: 'provider_default',
    });
  });

  it('selects mistral-small-latest as the default lightweight model for mistral generic', () => {
    const config = {
      firstRun: false,
      version: 'test',
      provider: 'mistral',
      model: 'mistral-large-latest',
      apiKeys: {
        mistral: 'generic-key',
      },
    };

    expect(getLightweightRoute('mistral', 'mistral-large-latest', { config })).toEqual({
      providerId: 'mistral',
      modelId: 'mistral-small-latest',
      source: 'provider_default',
    });
  });
});
