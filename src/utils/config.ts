import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from './version';

const CONFIG_DIR = join(homedir(), '.mosaic');
const CONFIG_FILE = join(CONFIG_DIR, 'mosaic.jsonc');
const CODEX_CONFIG_FILE = join(homedir(), '.codex', 'config.toml');

export interface AIProvider {
  id: string;
  name: string;
  description: string;
  models: AIModel[];
  requiresApiKey: boolean;
}

export interface AIModel {
  id: string;
  name: string;
  description: string;
  requiresApiKey?: boolean;
}

export interface CustomProvider extends AIProvider {
  baseUrl?: string;
  isCustom: true;
}

export interface RecentProject {
  path: string;
  lastOpened: number;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface MosaicConfig {
  firstRun: boolean;
  version: string;
  provider?: string;
  model?: string;
  modelReasoningEffort?: ReasoningEffort;
  apiKey?: string;
  apiKeys?: Record<string, string>;
  oauthTokens?: Record<string, OAuthTokenState>;
  oauthModels?: { [providerId: string]: AIModel[] };
  systemPrompt?: string;
  maxSteps?: number;
  maxContextTokens?: number;
  customProviders?: CustomProvider[];
  customModels?: { [providerId: string]: AIModel[] };
  requireApprovals?: boolean;
  recentProjects?: RecentProject[];
}

export interface OAuthTokenState {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

const OPENAI_CHATGPT_OAUTH_FALLBACK_MODELS = [
  'codex-auto-review',
  'gpt-5.4',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.1-codex-mini',
] as const;

const OPENAI_CHATGPT_OAUTH_MODEL_DETAILS: Record<string, AIModel> = {
  'codex-auto-review': {
    id: 'codex-auto-review',
    name: 'Codex Auto Review',
    description: 'Automated Codex review model available with ChatGPT Plus',
  },
  'gpt-5.4': {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'Latest frontier agentic coding model',
  },
  'gpt-5.2-codex': {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2 Codex',
    description: 'Frontier agentic coding model',
  },
  'gpt-5.1-codex': {
    id: 'gpt-5.1-codex',
    name: 'GPT-5.1 Codex',
    description: 'Codex model for OpenAI OAuth with a ChatGPT account',
  },
  'gpt-5.1-codex-mini': {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT-5.1 Codex Mini',
    description: 'Fast supported Codex model for OpenAI OAuth with a ChatGPT account',
  },
  'gpt-5.1-codex-max': {
    id: 'gpt-5.1-codex-max',
    name: 'GPT-5.1 Codex Max',
    description: 'Codex-optimized flagship for deep and fast reasoning',
  },
  'gpt-5.4-mini': {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    description: 'Smaller frontier agentic coding model',
  },
  'gpt-5.3-codex': {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    description: 'Frontier Codex-optimized agentic coding model',
  },
  'gpt-5.2': {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    description: 'Optimized for professional work and long-running agents',
  },
  'codex-mini-latest': {
    id: 'codex-mini-latest',
    name: 'Codex Mini Latest',
    description: 'Fast reasoning model optimized for Codex CLI',
  },
};

function createOpenAIOAuthModel(modelId: string): AIModel {
  return OPENAI_CHATGPT_OAUTH_MODEL_DETAILS[modelId] || {
    id: modelId,
    name: modelId,
    description: 'Supported Codex model for OpenAI OAuth with a ChatGPT account',
  };
}

function getOpenAIOAuthFallbackModels(): AIModel[] {
  return OPENAI_CHATGPT_OAUTH_FALLBACK_MODELS.map(modelId => createOpenAIOAuthModel(modelId));
}

function getConfiguredOpenAIOAuthModels(config: MosaicConfig): AIModel[] {
  return (config.oauthModels?.openai || [])
    .filter(model => typeof model?.id === 'string' && model.id.trim().length > 0)
    .map(model => createOpenAIOAuthModel(model.id.trim()));
}

function getSupportedOpenAIOAuthModelIdsFromConfig(config: MosaicConfig): string[] {
  const configured = getConfiguredOpenAIOAuthModels(config).map(model => model.id);
  return Array.from(new Set([...OPENAI_CHATGPT_OAUTH_FALLBACK_MODELS, ...configured]));
}

function getSupportedOpenAIOAuthModelsFromConfig(config: MosaicConfig): AIModel[] {
  return getSupportedOpenAIOAuthModelIdsFromConfig(config).map(modelId => createOpenAIOAuthModel(modelId));
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function sanitizeLoadedConfig(config: MosaicConfig): MosaicConfig {
  if (config.modelReasoningEffort && !isReasoningEffort(config.modelReasoningEffort)) {
    delete config.modelReasoningEffort;
  }

  if (config.oauthTokens?.openai?.accessToken) {
    if (!config.oauthModels) {
      config.oauthModels = {};
    }
    const supportedIds = getSupportedOpenAIOAuthModelIdsFromConfig(config);
    config.oauthModels.openai = supportedIds.map(modelId => createOpenAIOAuthModel(modelId));

    if (config.provider === 'openai') {
      const supported = new Set(supportedIds.map(id => id.toLowerCase()));
      const current = normalizeOpenAIOAuthModelId(config.model, supportedIds);
      if (!current || !supported.has(current.toLowerCase())) {
        config.model = supportedIds[0];
      } else if (config.model !== current) {
        config.model = current;
      }
    }
  }

  return config;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models from OpenAI',
    requiresApiKey: true,
    models: [
      { id: 'gpt-5.4-2026-03-25', name: 'GPT-5.4', description: 'Latest GPT-5.4 model from OpenAI for coding and agentic tasks' },
      { id: 'gpt-5.2-2025-12-11', name: 'GPT-5.2', description: 'The best model for coding and agentic tasks across industries' },
      { id: 'gpt-5.1-2025-11-13', name: 'GPT-5.1', description: 'The best model for coding and agentic tasks with configurable reasoning effort' },
      { id: 'gpt-5-2025-08-07', name: 'GPT-5', description: 'The first model GPT 5 series from OpenAI' },
      { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', description: 'Smartest non-reasoning model from OpenAI' },
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models with extended context windows',
    requiresApiKey: true,
    models: [
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', description: 'Most capable Claude model' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', description: 'Balanced performance and speed' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Previous Sonnet model' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest Claude model' },
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral',
    description: 'Mistral AI is a French company that develops open and efficient artificial intelligence models for various applications',
    requiresApiKey: true,
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large 3', description: 'Mistral Large 3, is a state-of-the-art, open-weight, general-purpose multimodal model' },
      { id: 'devstral-medium-latest', name: 'Devstral 2', description: 'Frontier code agents model for solving software engineering tasks' },
      { id: 'mistral-medium-latest', name: 'Mistral Medium 3.1', description: 'Frontier-class multimodal model' },
    ]
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'xAI is an AI company focused on creating AI for understanding the universe',
    requiresApiKey: true,
    models: [
      { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast Reasoning', description: 'A frontier multimodal model optimized specifically for high-performance agentic tool calling' },
      { id: 'grok-4-fast-reasoning', name: 'Grok 4 Fast Reasoning', description: 'Advancement in cost-efficient reasoning models.' },
      { id: 'grok-code-fast-1', name: 'Grok Code Fast 1', description: 'Optimized model for coding, programming, and software development tasks' },
    ]
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Introducing Google would almost be insulting',
    requiresApiKey: true,
    models: [
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', description: 'The first model in the new series, is ideal for complex tasks that require extensive world knowledge and advanced reasoning in multiple modalities' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', description: 'Latest model in the 3 series. It offers Pro-level intelligence at the speed and price of Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'A versatile, cutting-edge model that excels in complex coding and reasoning tasks' },
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run models locally on your machine',
    requiresApiKey: false,
    models: [
      { id: 'gpt-oss:120b', name: 'GPT OSS 120b', description: 'Best OSS reasoning model (and only one) OpenAI created' },
      { id: 'glm-5:cloud', name: 'GLM 5 Cloud', description: 'Advancing the coding capability, from zAI', requiresApiKey: true },
      { id: 'devstral-2:123b-cloud', name: 'Devstral 2 Cloud', description: 'Devstral is an agentic LLM for software engineering tasks, from Mistral', requiresApiKey: true },
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'GroqCloud hosted models and systems',
    requiresApiKey: true,
    models: [
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Fast general model with 131k context window' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', description: 'High quality general model with 131k context window' },
      { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', description: 'OpenAI open-weight model hosted on GroqCloud' },
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access to various AI models through a unified API',
    requiresApiKey: true,
    models: [
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: 'Most capable Claude model' },
      { id: 'x-ai/grok-code-fast-1', name: 'Grok Code Fast 1', description: 'Grok Code Fast 1 is a speedy and economical reasoning model that excels at agentic coding.' },
      { id: 'anthropic/claude-opus-4.5', name: 'Claude 3', description: 'Most capable Claude model' },
    ]
  }
];
export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function isFirstRun(): boolean {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return true;
  }

  try {
    const config = readConfig();
    return config.firstRun !== false;
  } catch {
    return true;
  }
}

export function readConfig(): MosaicConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {
      firstRun: true,
      version: VERSION,
      requireApprovals: true
    };
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = sanitizeLoadedConfig(JSON.parse(content));

    if (config.requireApprovals === undefined) {
      config.requireApprovals = true;
    }

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('Config file is corrupted. Resetting to default.');
      try {
        const { renameSync } = require('fs');
        renameSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);
      } catch { }
    }
    return {
      firstRun: true,
      version: VERSION,
      requireApprovals: true
    };
  }
}

export function writeConfig(config: MosaicConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function readCodexModelReasoningEffort(): ReasoningEffort | undefined {
  try {
    const content = readFileSync(CODEX_CONFIG_FILE, 'utf-8');
    const match = content.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
    const value = match?.[1]?.trim().toLowerCase();
    if (value && isReasoningEffort(value)) {
      return value;
    }
  } catch {
  }
  return undefined;
}

export function getAvailableReasoningEfforts(): readonly ReasoningEffort[] {
  return REASONING_EFFORTS;
}

export function getCodexModelReasoningEffort(): ReasoningEffort | undefined {
  return readCodexModelReasoningEffort();
}

export function getDefaultModelReasoningEffort(): ReasoningEffort {
  return readCodexModelReasoningEffort() ?? 'medium';
}

export function getModelReasoningEffort(): ReasoningEffort {
  const configured = readConfig().modelReasoningEffort;
  if (configured && isReasoningEffort(configured)) {
    return configured;
  }
  return getDefaultModelReasoningEffort();
}

export function getModelReasoningEffortSource(): 'mosaic' | 'codex' | 'default' {
  const configured = readConfig().modelReasoningEffort;
  if (configured && isReasoningEffort(configured)) {
    return 'mosaic';
  }
  return readCodexModelReasoningEffort() ? 'codex' : 'default';
}

export function setModelReasoningEffort(effort: ReasoningEffort): void {
  const config = readConfig();
  config.modelReasoningEffort = effort;
  writeConfig(config);
}

export function clearModelReasoningEffort(): void {
  const config = readConfig();
  delete config.modelReasoningEffort;
  writeConfig(config);
}

export function markFirstRunComplete(provider: string, model: string, apiKey?: string): void {
  const config = readConfig();
  config.firstRun = false;
  config.provider = provider;
  config.model = model;
  config.apiKey = apiKey;
  if (apiKey) {
    if (!config.apiKeys) config.apiKeys = {};
    config.apiKeys[provider] = apiKey;
  }
  writeConfig(config);
}

export function setFirstRunComplete(provider: string, model: string): void {
  const config = readConfig();
  config.firstRun = false;
  config.provider = provider;
  config.model = model;
  const stored = config.apiKeys?.[provider];
  if (stored) {
    config.apiKey = stored;
  }
  writeConfig(config);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getAllProviders(options?: { includeOAuthModels?: boolean }): AIProvider[] {
  const config = readConfig();
  const customProviders = config.customProviders || [];
  const customModels = config.customModels || {};
  const oauthModels = options?.includeOAuthModels === false ? {} : (config.oauthModels || {});

  const providersWithCustomModels = AI_PROVIDERS.map(provider => {
    const hasOAuthToken = provider.id !== 'anthropic' && !!config.oauthTokens?.[provider.id]?.accessToken;
    const openaiOAuthModels =
      provider.id === 'openai' && hasOAuthToken
        ? getConfiguredOpenAIOAuthModels(config).length > 0
          ? getConfiguredOpenAIOAuthModels(config)
          : getOpenAIOAuthFallbackModels()
        : [];
    const baseModels =
      provider.id === 'openai' && hasOAuthToken
        ? openaiOAuthModels
        : provider.models;
    const customModelsForProvider = customModels[provider.id] || [];
    const oauthModelsForProvider = provider.id === 'anthropic'
      ? []
      : provider.id === 'openai'
        ? []
        : (oauthModels[provider.id] || []);
    const mergedModels = [...baseModels, ...oauthModelsForProvider, ...customModelsForProvider].filter((model, index, list) =>
      list.findIndex(m => m.id === model.id) === index
    );
    if (customModelsForProvider.length > 0) {
      return {
        ...provider,
        models: mergedModels
      };
    }
    if (oauthModelsForProvider.length > 0) {
      return {
        ...provider,
        models: mergedModels
      };
    }
    return provider;
  });
  return [...providersWithCustomModels, ...customProviders];
}

export function getProviderById(id: string): AIProvider | undefined {
  return getAllProviders().find(p => p.id === id);
}

export function getPreferredModelForProvider(providerId: string): string | undefined {
  const provider = getProviderById(providerId);
  return provider?.models[0]?.id;
}

export function normalizeModelForProvider(providerId: string, modelId?: string): string | undefined {
  const provider = getProviderById(providerId);
  if (!provider) return modelId;
  if (providerId === 'openai' && readConfig().oauthTokens?.openai?.accessToken) {
    const normalizedOAuthModel = normalizeOpenAIOAuthModelId(modelId, getSupportedOpenAIOAuthModelIdsFromConfig(readConfig()));
    if (normalizedOAuthModel) {
      return normalizedOAuthModel;
    }
  }
  if (modelId && provider.models.some(model => model.id === modelId)) {
    return modelId;
  }
  return provider.models[0]?.id ?? modelId;
}

export function getModelById(providerId: string, modelId: string): AIModel | undefined {
  const provider = getProviderById(providerId);
  return provider?.models.find(m => m.id === modelId);
}

export function modelRequiresApiKey(providerId: string, modelId: string): boolean {
  const provider = getProviderById(providerId);
  const model = getModelById(providerId, modelId);
  const config = readConfig();
  if (providerId !== 'anthropic' && config.oauthTokens?.[providerId]?.accessToken) return false;
  if (model?.requiresApiKey !== undefined) {
    return model.requiresApiKey === true;
  }

  return provider?.requiresApiKey === true;
}

export function addCustomProvider(provider: CustomProvider): void {
  const config = readConfig();
  if (!config.customProviders) {
    config.customProviders = [];
  }
  config.customProviders.push(provider);
  writeConfig(config);
}

export function removeCustomProvider(id: string): void {
  const config = readConfig();
  if (config.customProviders) {
    config.customProviders = config.customProviders.filter(p => p.id !== id);
    writeConfig(config);
  }
}

export function updateCustomProvider(id: string, updates: Partial<CustomProvider>): void {
  const config = readConfig();
  if (config.customProviders) {
    const index = config.customProviders.findIndex(p => p.id === id);
    if (index !== -1) {
      config.customProviders[index] = { ...config.customProviders[index]!, ...updates };
      writeConfig(config);
    }
  }
}

export function addCustomModel(providerId: string, model: AIModel): void {
  const config = readConfig();
  if (!config.customModels) {
    config.customModels = {};
  }
  if (!config.customModels[providerId]) {
    config.customModels[providerId] = [];
  }
  config.customModels[providerId].push(model);
  writeConfig(config);
}

export function setOAuthModelsForProvider(providerId: string, models: AIModel[]): void {
  const config = readConfig();
  if (!config.oauthModels) {
    config.oauthModels = {};
  }
  config.oauthModels[providerId] = models;
  writeConfig(config);
}

export function getOAuthModelsForProvider(providerId: string): AIModel[] {
  const config = readConfig();
  return config.oauthModels?.[providerId] || [];
}

export function removeCustomModel(providerId: string, modelId: string): void {
  const config = readConfig();
  if (config.customModels && config.customModels[providerId]) {
    config.customModels[providerId] = config.customModels[providerId].filter(m => m.id !== modelId);
    writeConfig(config);
  }
}

export function getCustomModels(providerId: string): AIModel[] {
  const config = readConfig();
  return config.customModels?.[providerId] || [];
}

export function updateSystemPrompt(systemPrompt: string): void {
  const config = readConfig();
  config.systemPrompt = systemPrompt;
  writeConfig(config);
}

export function getSystemPrompt(): string | undefined {
  const config = readConfig();
  return config.systemPrompt;
}

export function shouldRequireApprovals(): boolean {
  const config = readConfig();
  return config.requireApprovals !== false;
}

export function setRequireApprovals(require: boolean): void {
  const config = readConfig();
  config.requireApprovals = require;
  writeConfig(config);
}

const MAX_RECENT_PROJECTS = 10;

export function getRecentProjects(): RecentProject[] {
  const config = readConfig();
  return config.recentProjects || [];
}

export function addRecentProject(projectPath: string): void {
  const config = readConfig();
  const recentProjects = config.recentProjects || [];

  const existingIndex = recentProjects.findIndex(p => p.path === projectPath);
  if (existingIndex !== -1) {
    recentProjects.splice(existingIndex, 1);
  }

  recentProjects.unshift({
    path: projectPath,
    lastOpened: Date.now()
  });

  if (recentProjects.length > MAX_RECENT_PROJECTS) {
    recentProjects.pop();
  }

  config.recentProjects = recentProjects;
  writeConfig(config);
}

export function removeRecentProject(projectPath: string): void {
  const config = readConfig();
  if (config.recentProjects) {
    config.recentProjects = config.recentProjects.filter(p => p.path !== projectPath);
    writeConfig(config);
  }
}

export function clearRecentProjects(): void {
  const config = readConfig();
  config.recentProjects = [];
  writeConfig(config);
}

export function getApiKeyForProvider(providerId: string): string | undefined {
  const config = readConfig();
  return config.apiKeys?.[providerId] ?? (config.provider === providerId ? config.apiKey : undefined);
}

export function getOAuthTokenForProvider(providerId: string): OAuthTokenState | undefined {
  const config = readConfig();
  return config.oauthTokens?.[providerId];
}

export function setOAuthTokenForProvider(providerId: string, token: OAuthTokenState): void {
  const config = readConfig();
  if (!config.oauthTokens) config.oauthTokens = {};
  config.oauthTokens[providerId] = token;
  writeConfig(config);
}

export function removeOAuthTokenForProvider(providerId: string): void {
  const config = readConfig();
  if (config.oauthTokens) {
    delete config.oauthTokens[providerId];
  }
  writeConfig(config);
}

export function getAuthForProvider(providerId: string):
  | { type: 'api_key'; apiKey: string }
  | { type: 'oauth'; accessToken: string; refreshToken?: string; expiresAt?: number; tokenType?: string; scope?: string }
  | undefined {
  const oauth = providerId === 'anthropic' ? undefined : getOAuthTokenForProvider(providerId);
  if (oauth?.accessToken) {
    return {
      type: 'oauth',
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      tokenType: oauth.tokenType,
      scope: oauth.scope,
    };
  }
  const apiKey = getApiKeyForProvider(providerId);
  if (apiKey) return { type: 'api_key', apiKey };
  return undefined;
}

export function mapModelForOAuth(modelId: string): string {
  return normalizeOpenAIOAuthModelId(modelId, getSupportedOpenAIOAuthModelIdsFromConfig(readConfig())) ?? modelId;
}

export function getSupportedOpenAIOAuthModels(): readonly string[] {
  return getSupportedOpenAIOAuthModelIdsFromConfig(readConfig());
}

export function isSupportedOpenAIOAuthModel(modelId: string): boolean {
  const id = modelId.toLowerCase().trim();
  return getSupportedOpenAIOAuthModels().some(model => model.toLowerCase() === id);
}

function normalizeOpenAIOAuthModelId(modelId: string | undefined, supportedModels: readonly string[]): string | undefined {
  const raw = modelId?.trim();
  if (!raw) return undefined;
  const supported = new Set(supportedModels.map(model => model.toLowerCase()));

  if (supported.has(raw.toLowerCase())) {
    return raw;
  }

  const datedAlias = raw.match(/^(gpt-\d+(?:\.\d+)?)(?:-\d{4}-\d{2}-\d{2})$/i);
  if (datedAlias && supported.has(datedAlias[1]!.toLowerCase())) {
    return datedAlias[1]!;
  }

  const lowered = raw.toLowerCase();
  const aliases: Record<string, string> = {
    'gpt-5.4-2026-03-25': 'gpt-5.4',
    'gpt-5.2-2025-12-11': 'gpt-5.2',
    'gpt-5.1-2025-11-13': 'gpt-5.1-codex-max',
  };
  const mapped = aliases[lowered];
  if (mapped && supported.has(mapped.toLowerCase())) {
    return mapped;
  }

  return undefined;
}
export function setApiKeyForProvider(providerId: string, key: string): void {
  const config = readConfig();
  if (!config.apiKeys) config.apiKeys = {};
  config.apiKeys[providerId] = key;
  if (config.provider === providerId) {
    config.apiKey = key;
  }
  writeConfig(config);
}

export function removeApiKeyForProvider(providerId: string): void {
  const config = readConfig();
  if (config.apiKeys) {
    delete config.apiKeys[providerId];
  }
  if (config.provider === providerId) {
    config.apiKey = undefined;
  }
  writeConfig(config);
}

export function getStoredProviderIds(): string[] {
  const config = readConfig();
  const ids = new Set<string>();
  if (config.apiKeys) {
    for (const id of Object.keys(config.apiKeys)) {
      if (config.apiKeys[id]) ids.add(id);
    }
  }
  if (config.oauthTokens) {
    for (const id of Object.keys(config.oauthTokens)) {
      if (config.oauthTokens[id]?.accessToken) ids.add(id);
    }
  }
  if (config.apiKey && config.provider && !ids.has(config.provider)) {
    ids.add(config.provider);
  }
  return [...ids];
}

export function setActiveProvider(providerId: string): void {
  const config = readConfig();
  config.provider = providerId;
  config.apiKey = config.apiKeys?.[providerId] ?? config.apiKey;
  writeConfig(config);
}

export function setActiveModel(modelId: string): void {
  const config = readConfig();
  config.model = modelId;
  writeConfig(config);
}
