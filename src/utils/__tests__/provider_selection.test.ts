import { describe, expect, it, beforeEach } from 'bun:test';
import { 
  readConfig, 
  writeConfig, 
  setActiveProvider, 
  setActiveModel,
  getAllProviders,
  normalizeModelForProvider,
  setOAuthTokenForProvider,
  type MosaicConfig
} from '../config';

const createDefaultConfig = (): MosaicConfig => ({
  firstRun: false,
  version: 'test',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKeys: {
    anthropic: 'anthropic-key'
  }
});

describe('Provider Selection and OAuth persistence', () => {
  beforeEach(() => {
    writeConfig(createDefaultConfig());
  });

  it('correctly separates API-key and OAuth providers', () => {
    const providers = getAllProviders();
    
    const googleApiKey = providers.find(p => p.id === 'google');
    const googleOAuth = providers.find(p => p.id === 'google-oauth');
    
    expect(googleApiKey?.requiresApiKey).toBe(true);
    expect(googleOAuth?.requiresApiKey).toBe(false);

    const openaiApiKey = providers.find(p => p.id === 'openai');
    const openaiOAuth = providers.find(p => p.id === 'openai-oauth');
    
    expect(openaiApiKey?.requiresApiKey).toBe(true);
    expect(openaiOAuth?.requiresApiKey).toBe(false);
  });

  it('preserves the correct model when switching between API-key and OAuth providers', () => {
    // Setup OpenAI OAuth
    setOAuthTokenForProvider('openai-oauth', {
      accessToken: 'openai-token'
    });
    
    setActiveProvider('openai-oauth');
    setActiveModel('gpt-5.4-mini');
    
    expect(readConfig().provider).toBe('openai-oauth');
    expect(readConfig().model).toBe('gpt-5.4-mini');

    // Switch to Anthropic (API key)
    setActiveProvider('anthropic');
    setActiveModel('claude-opus-4-5');
    
    expect(readConfig().provider).toBe('anthropic');
    expect(readConfig().model).toBe('claude-opus-4-5');

    // Switch back to OpenAI OAuth
    setActiveProvider('openai-oauth');
    // normalizeModelForProvider should help here
    const model = normalizeModelForProvider('openai-oauth', 'gpt-5.4-mini');
    if (model) setActiveModel(model);

    expect(readConfig().provider).toBe('openai-oauth');
    expect(readConfig().model).toBe('gpt-5.4-mini');
  });

  it('clears current API key field when switching to an OAuth provider if no key exists for it', () => {
    // Anthropic has a key
    setActiveProvider('anthropic');
    expect(readConfig().apiKey).toBe('anthropic-key');

    // Set OpenAI OAuth
    setOAuthTokenForProvider('openai-oauth', { accessToken: 'oa' });
    
    // Switch to OpenAI OAuth
    setActiveProvider('openai-oauth');
    
    // It should clear the anthropic-key from the current apiKey field because openai-oauth has no stored apiKey
    expect(readConfig().apiKey).toBeUndefined();
  });

  it('correctly remembers the last used model for each real provider ID', () => {
    // Set Google OAuth token
    setOAuthTokenForProvider('google-oauth', { accessToken: 'go' });
    
    // Switch to Google OAuth, set a model
    setActiveProvider('google-oauth');
    setActiveModel('gemini-2.5-pro');
    expect(readConfig().model).toBe('gemini-2.5-pro');

    // Switch to Anthropic, set a model
    setActiveProvider('anthropic');
    setActiveModel('claude-opus-4-5');
    expect(readConfig().model).toBe('claude-opus-4-5');

    // Switch back to Google OAuth - should remember gemini-2.5-pro
    setActiveProvider('google-oauth');
    expect(readConfig().model).toBe('gemini-2.5-pro');

    // Switch back to Anthropic - should remember claude-opus-4-5
    setActiveProvider('anthropic');
    expect(readConfig().model).toBe('claude-opus-4-5');
  });

  it('migrates legacy openai provider to openai-oauth if OAuth token exists', () => {
    // Simulate legacy config
    const legacyConfig: MosaicConfig = {
      ...createDefaultConfig(),
      provider: 'openai',
      model: 'gpt-5.4-mini',
      oauthTokens: {
        openai: { accessToken: 'legacy-token' }
      }
    };
    writeConfig(legacyConfig);

    // Reading config should trigger migration
    const config = readConfig();
    expect(config.provider).toBe('openai-oauth');
    expect(config.oauthTokens?.['openai-oauth']?.accessToken).toBe('legacy-token');
    expect(config.oauthTokens?.openai).toBeUndefined();
  });
});
