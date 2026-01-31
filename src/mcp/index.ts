import { loadMcpConfig } from './config';
import { McpProcessManager } from './processManager';
import { McpApprovalPolicy } from './approvalPolicy';
import { McpToolCatalog } from './toolCatalog';

export type { McpServerConfig, McpServerState, McpToolInfo, McpRiskHint, McpGlobalConfig } from './types';
export { toCanonicalId, toSafeId, parseSafeId, parseCanonicalId } from './types';

let manager: McpProcessManager | null = null;
let catalog: McpToolCatalog | null = null;
let approvalPolicy: McpApprovalPolicy | null = null;
let initialized = false;

export function getMcpManager(): McpProcessManager {
  if (!manager) {
    manager = new McpProcessManager();
  }
  return manager;
}

export function getMcpCatalog(): McpToolCatalog {
  if (!catalog) {
    throw new Error('MCP not initialized. Call initializeMcp() first.');
  }
  return catalog;
}

export function getMcpApprovalPolicy(): McpApprovalPolicy {
  if (!approvalPolicy) {
    approvalPolicy = new McpApprovalPolicy();
  }
  return approvalPolicy;
}

export async function initializeMcp(): Promise<string[]> {
  if (initialized) return [];

  const configs = loadMcpConfig();
  if (configs.length === 0) {
    initialized = true;
    return [];
  }

  manager = new McpProcessManager();
  approvalPolicy = new McpApprovalPolicy();
  catalog = new McpToolCatalog(manager, approvalPolicy, configs);

  const startupServers = configs.filter(c => c.enabled && c.autostart === 'startup');
  const failedServers: string[] = [];

  for (const config of startupServers) {
    try {
      await manager.startServer(config);
    } catch {
      failedServers.push(config.id || config.command || 'unknown');
    }
  }

  if (failedServers.length > 0) {
    console.error(`MCP: failed to start servers: ${failedServers.join(', ')}`);
  }

  catalog.refreshTools();
  initialized = true;
  return failedServers;
}

export async function shutdownMcp(): Promise<void> {
  if (manager) {
    await manager.shutdownAll();
  }
  manager = null;
  catalog = null;
  approvalPolicy = null;
  initialized = false;
}

export function isMcpInitialized(): boolean {
  return initialized;
}