import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from './version';

const CONFIG_DIR = join(homedir(), '.mosaic');
const CONFIG_FILE = join(CONFIG_DIR, 'mosaic.jsonc');

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

export interface MosaicConfig {
  firstRun: boolean;
  version: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  customProviders?: CustomProvider[];
  customModels?: { [providerId: string]: AIModel[] };
  requireApprovals?: boolean;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models from OpenAI',
    requiresApiKey: true,
    models: [
      { id: 'gpt-5.2-2025-12-11', name: 'GPT-5.2', description: 'The best model for coding and agentic tasks across industries' },
      { id: 'gpt-5.1-2025-11-13', name: 'GPT-5.1', description: 'The best model for coding and agentic tasks with configurable reasoning effort' },
      { id: 'gpt-5-2025-08-07', name: 'GPT-5', description: 'The first model GPT 5 series from OpenAI'},
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
      { id: 'glm-4.7:cloud', name: 'GLM 4.7 Cloud', description: 'Advancing the coding capability, from zAI', requiresApiKey: true },
      { id: 'devstral-2:123b-cloud', name: 'Devstral 2 Cloud', description: 'Devstral is an agentic LLM for software engineering tasks, from Mistral', requiresApiKey: true },
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

  const content = readFileSync(CONFIG_FILE, 'utf-8');
  const config = JSON.parse(content);

  if (config.requireApprovals === undefined) {
    config.requireApprovals = true;
  }

  return config;
}

export function writeConfig(config: MosaicConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function markFirstRunComplete(provider: string, model: string, apiKey?: string): void {
  const config = readConfig();
  config.firstRun = false;
  config.provider = provider;
  config.model = model;
  config.apiKey = apiKey;
  writeConfig(config);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getAllProviders(): AIProvider[] {
  const config = readConfig();
  const customProviders = config.customProviders || [];
  const customModels = config.customModels || {};

  const providersWithCustomModels = AI_PROVIDERS.map(provider => {
    const customModelsForProvider = customModels[provider.id] || [];
    if (customModelsForProvider.length > 0) {
      return {
        ...provider,
        models: [...provider.models, ...customModelsForProvider]
      };
    }
    return provider;
  });

  return [...providersWithCustomModels, ...customProviders];
}

export function getProviderById(id: string): AIProvider | undefined {
  return getAllProviders().find(p => p.id === id);
}

export function getModelById(providerId: string, modelId: string): AIModel | undefined {
  const provider = getProviderById(providerId);
  return provider?.models.find(m => m.id === modelId);
}

export function modelRequiresApiKey(providerId: string, modelId: string): boolean {
  const provider = getProviderById(providerId);
  const model = getModelById(providerId, modelId);

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