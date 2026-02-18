import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import type { McpServerConfig, McpGlobalConfig } from './types';

const MCP_DIR = join(homedir(), '.mosaic', 'mcp');
const CONFIG_FILE = join(MCP_DIR, 'config.json');
const SERVERS_DIR = join(MCP_DIR, 'servers');

function resolveNativeTsRunner(serverPath: string): { command: string; args: string[] } {
  if (typeof process.versions.bun === 'string') {
    return {
      command: 'bun',
      args: ['run', serverPath],
    };
  }

  return {
    command: 'npx',
    args: ['tsx', serverPath],
  };
}

function normalizeNativeServerRunner(partial: Partial<McpServerConfig>): Partial<McpServerConfig> {
  if (partial.id !== 'nativereact' && partial.id !== 'nativesearch') {
    return partial;
  }

  const relativePath = partial.id === 'nativereact'
    ? './servers/nativereact/index.ts'
    : './servers/nativesearch/index.ts';
  const serverPath = fileURLToPath(new URL(relativePath, import.meta.url));
  const runner = resolveNativeTsRunner(serverPath);
  const currentCommand = partial.command;
  const currentArgs = partial.args || [];
  const target = currentArgs[1] || '';

  const isDefaultNpxRunner =
    currentCommand === 'npx' &&
    currentArgs[0] === 'tsx' &&
    (target === serverPath || target.endsWith(relativePath.replace('./', '').replace(/\//g, '\\')) || target.endsWith(relativePath.replace('./', '')));

  if (isDefaultNpxRunner) {
    return {
      ...partial,
      command: runner.command,
      args: runner.args,
    };
  }

  return partial;
}

function ensureDirs(): void {
  if (!existsSync(MCP_DIR)) mkdirSync(MCP_DIR, { recursive: true });
  if (!existsSync(SERVERS_DIR)) mkdirSync(SERVERS_DIR, { recursive: true });
}

export function getDefaultServerConfig(): Partial<McpServerConfig> {
  return {
    enabled: true,
    transport: { type: 'stdio' },
    args: [],
    autostart: 'startup',
    timeouts: {
      initialize: 30000,
      call: 60000,
    },
    limits: {
      maxCallsPerMinute: 60,
      maxPayloadBytes: 1024 * 1024,
    },
    logs: {
      persist: false,
      bufferSize: 200,
    },
    tools: {},
    approval: 'always',
  };
}

function getNativeSearchServerConfig(): Partial<McpServerConfig> {
  const serverPath = fileURLToPath(new URL('./servers/nativesearch/index.ts', import.meta.url));
  const runner = resolveNativeTsRunner(serverPath);
  return {
    id: 'nativesearch',
    name: 'NativeSearch',
    native: true,
    command: runner.command,
    args: runner.args,
    enabled: true,
    autostart: 'startup',
    approval: 'never',
    toolApproval: {
      nativesearch_cookies: 'always',
      nativesearch_headers: 'always',
    },
    timeouts: {
      initialize: 30000,
      call: 60000,
    },
  };
}

function getNativeReactServerConfig(): Partial<McpServerConfig> {
  const serverPath = fileURLToPath(new URL('./servers/nativereact/index.ts', import.meta.url));
  const runner = resolveNativeTsRunner(serverPath);
  return {
    id: 'nativereact',
    name: 'NativeReact',
    native: true,
    command: runner.command,
    args: runner.args,
    enabled: true,
    autostart: 'startup',
    approval: 'never',
    timeouts: {
      initialize: 30000,
      call: 120000,
    },
  };
}

export function validateServerConfig(config: Partial<McpServerConfig>): string[] {
  const errors: string[] = [];

  if (!config.id || typeof config.id !== 'string') {
    errors.push('Server id is required and must be a string');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(config.id)) {
    errors.push('Server id must contain only alphanumeric characters, hyphens, and underscores');
  }

  if (!config.name || typeof config.name !== 'string') {
    errors.push('Server name is required and must be a string');
  }

  if (!config.command || typeof config.command !== 'string') {
    errors.push('Server command is required and must be a string');
  }

  if (config.args && !Array.isArray(config.args)) {
    errors.push('Server args must be an array of strings');
  }

  if (config.autostart && !['startup', 'on-demand', 'never'].includes(config.autostart)) {
    errors.push('Server autostart must be "startup", "on-demand", or "never"');
  }

  if (config.approval && !['always', 'once-per-tool', 'once-per-server', 'never'].includes(config.approval)) {
    errors.push('Server approval must be "always", "once-per-tool", "once-per-server", or "never"');
  }

  return errors;
}

function resolveServerName(partial: Partial<McpServerConfig>): string {
  const rawName = typeof partial.name === 'string' ? partial.name.trim() : '';
  if (partial.id === 'nativesearch') {
    if (!rawName || /^nativesearch$/i.test(rawName) || /^browser nativesearch$/i.test(rawName)) {
      return 'NativeSearch';
    }
  }
  if (partial.id === 'nativereact') {
    if (!rawName || /^nativereact$/i.test(rawName)) {
      return 'NativeReact';
    }
  }
  return rawName || partial.id!;
}

function mergeWithDefaults(partial: Partial<McpServerConfig>): McpServerConfig {
  const normalizedPartial = normalizeNativeServerRunner(partial);
  const defaults = getDefaultServerConfig();
  return {
    id: normalizedPartial.id!,
    name: resolveServerName(normalizedPartial),
    enabled: normalizedPartial.enabled ?? defaults.enabled!,
    native: normalizedPartial.native,
    transport: normalizedPartial.transport || defaults.transport!,
    command: normalizedPartial.command!,
    args: normalizedPartial.args || defaults.args!,
    cwd: normalizedPartial.cwd,
    env: normalizedPartial.env,
    autostart: normalizedPartial.autostart || defaults.autostart!,
    timeouts: { ...defaults.timeouts!, ...normalizedPartial.timeouts },
    limits: { ...defaults.limits!, ...normalizedPartial.limits },
    logs: { ...defaults.logs!, ...normalizedPartial.logs },
    tools: { ...defaults.tools, ...normalizedPartial.tools },
    approval: normalizedPartial.approval || defaults.approval!,
    toolApproval: normalizedPartial.toolApproval,
  };
}

function loadGlobalConfigFile(): Partial<McpGlobalConfig> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function loadServerFiles(): Partial<McpServerConfig>[] {
  if (!existsSync(SERVERS_DIR)) return [];
  const files = readdirSync(SERVERS_DIR).filter(f => f.endsWith('.json'));
  const configs: Partial<McpServerConfig>[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(SERVERS_DIR, file), 'utf-8');
      const parsed = JSON.parse(content);
      if (!parsed.id) {
        parsed.id = file.replace(/\.json$/, '');
      }
      configs.push(parsed);
    } catch {
      // skip invalid files
    }
  }

  return configs;
}

export function loadMcpConfig(): McpServerConfig[] {
  ensureDirs();

  const globalConfig = loadGlobalConfigFile();
  const serverFiles = loadServerFiles();

  const configMap = new Map<string, Partial<McpServerConfig>>();

  if (globalConfig.servers) {
    for (const server of globalConfig.servers) {
      if (server.id) {
        configMap.set(server.id, server);
      }
    }
  }

  for (const server of serverFiles) {
    if (server.id) {
      const existing = configMap.get(server.id);
      if (existing) {
        configMap.set(server.id, { ...existing, ...server });
      } else {
        configMap.set(server.id, server);
      }
    }
  }

  if (!configMap.has('nativesearch')) {
    configMap.set('nativesearch', getNativeSearchServerConfig());
  }

  if (!configMap.has('nativereact')) {
    configMap.set('nativereact', getNativeReactServerConfig());
  }

  const results: McpServerConfig[] = [];
  for (const [, partial] of configMap) {
    const errors = validateServerConfig(partial);
    if (errors.length === 0) {
      results.push(mergeWithDefaults(partial));
    }
  }

  return results;
}

export function saveServerConfig(config: Partial<McpServerConfig>): void {
  ensureDirs();
  const errors = validateServerConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid server config: ${errors.join(', ')}`);
  }
  const filePath = join(SERVERS_DIR, `${config.id}.json`);
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export function removeServerConfig(id: string): boolean {
  const filePath = join(SERVERS_DIR, `${id}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }

  const globalConfig = loadGlobalConfigFile();
  if (globalConfig.servers) {
    const idx = globalConfig.servers.findIndex(s => s.id === id);
    if (idx !== -1) {
      globalConfig.servers.splice(idx, 1);
      writeFileSync(CONFIG_FILE, JSON.stringify(globalConfig, null, 2), 'utf-8');
      return true;
    }
  }

  return false;
}

export function updateServerConfig(id: string, updates: Partial<McpServerConfig>): McpServerConfig | null {
  const configs = loadMcpConfig();
  const existing = configs.find(c => c.id === id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, id };
  saveServerConfig(updated);
  return updated;
}

export function getMcpConfigDir(): string {
  return MCP_DIR;
}

export function getServersDir(): string {
  return SERVERS_DIR;
}
