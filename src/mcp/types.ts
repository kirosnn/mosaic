export interface McpTransportConfig {
  type: 'stdio';
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  native?: boolean;
  transport: McpTransportConfig;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  autostart: 'startup' | 'on-demand' | 'never';
  timeouts: {
    initialize: number;
    call: number;
  };
  limits: {
    maxCallsPerMinute: number;
    maxPayloadBytes: number;
  };
  logs: {
    persist: boolean;
    path?: string;
    bufferSize: number;
  };
  tools: {
    allow?: string[];
    deny?: string[];
  };
  approval: McpApprovalMode;
  toolApproval?: Record<string, McpApprovalMode>;
}

export type McpApprovalMode = 'always' | 'once-per-tool' | 'once-per-server' | 'never';

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface McpServerState {
  status: McpServerStatus;
  pid?: number;
  initLatencyMs?: number;
  toolCount: number;
  lastError?: string;
  lastCallAt?: number;
}

export interface McpToolInfo {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  canonicalId: string;
  safeId: string;
}

export type McpRiskHint = 'read' | 'write' | 'execute' | 'network' | 'unknown';

export type McpApprovalScope = 'toolArgs' | 'tool' | 'server';

export interface McpApprovalCacheEntry {
  scope: McpApprovalScope;
  key: string;
  expiresAt: number;
}

export interface McpGlobalConfig {
  servers: McpServerConfig[];
}

export function toCanonicalId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function toSafeId(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

export function parseSafeId(safeId: string): { serverId: string; toolName: string } | null {
  if (!safeId.startsWith('mcp__')) return null;
  const parts = safeId.slice(5).split('__');
  if (parts.length < 2) return null;
  const toolName = parts.pop()!;
  const serverId = parts.join('__');
  return { serverId, toolName };
}

export function parseCanonicalId(canonicalId: string): { serverId: string; toolName: string } | null {
  if (!canonicalId.startsWith('mcp:')) return null;
  const parts = canonicalId.slice(4).split(':');
  if (parts.length < 2) return null;
  const toolName = parts.pop()!;
  const serverId = parts.join(':');
  return { serverId, toolName };
}

export const NATIVE_SERVER_IDS = new Set(['navigation']);

export function isNativeMcpServer(serverId: string): boolean {
  return NATIVE_SERVER_IDS.has(serverId);
}

export function isNativeMcpTool(safeId: string): boolean {
  const parsed = parseSafeId(safeId);
  if (!parsed) return false;
  return NATIVE_SERVER_IDS.has(parsed.serverId);
}

export function getNativeMcpToolName(safeId: string): string | null {
  const parsed = parseSafeId(safeId);
  if (!parsed) return null;
  if (!NATIVE_SERVER_IDS.has(parsed.serverId)) return null;
  return parsed.toolName;
}