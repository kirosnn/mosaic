import { createHash } from 'crypto';
import { requestApproval } from '../utils/approvalBridge';
import type { McpApprovalCacheEntry, McpApprovalScope, McpRiskHint, McpServerConfig } from './types';

const READ_KEYWORDS = ['read', 'get', 'list', 'search', 'find', 'show', 'describe', 'query', 'fetch', 'inspect', 'view', 'ls', 'cat'];
const WRITE_KEYWORDS = ['write', 'set', 'create', 'update', 'put', 'save', 'modify', 'patch', 'upsert', 'insert', 'append'];
const EXEC_KEYWORDS = ['exec', 'run', 'execute', 'spawn', 'shell', 'eval', 'invoke', 'call', 'process'];
const DELETE_KEYWORDS = ['delete', 'remove', 'destroy', 'drop', 'purge', 'clean', 'wipe', 'rm', 'unlink'];
const NET_KEYWORDS = ['http', 'request', 'download', 'upload', 'send', 'post', 'api', 'webhook', 'socket', 'connect'];

export class McpApprovalPolicy {
  private cache = new Map<string, McpApprovalCacheEntry>();

  inferRiskHint(toolName: string, _args: Record<string, unknown>): McpRiskHint {
    const lower = toolName.toLowerCase();

    for (const kw of DELETE_KEYWORDS) {
      if (lower.includes(kw)) return 'execute';
    }
    for (const kw of EXEC_KEYWORDS) {
      if (lower.includes(kw)) return 'execute';
    }
    for (const kw of WRITE_KEYWORDS) {
      if (lower.includes(kw)) return 'write';
    }
    for (const kw of NET_KEYWORDS) {
      if (lower.includes(kw)) return 'network';
    }
    for (const kw of READ_KEYWORDS) {
      if (lower.includes(kw)) return 'read';
    }

    return 'unknown';
  }

  async requestMcpApproval(request: {
    serverId: string;
    serverName: string;
    toolName: string;
    canonicalId: string;
    args: Record<string, unknown>;
    approvalMode: McpServerConfig['approval'];
  }): Promise<{ approved: boolean; customResponse?: string }> {
    if (request.approvalMode === 'never') {
      return { approved: true };
    }

    const riskHint = this.inferRiskHint(request.toolName, request.args);

    if (this.checkCache(request.serverId, request.toolName, request.args)) {
      return { approved: true };
    }

    const argsStr = formatArgs(request.args);
    const payloadSize = JSON.stringify(request.args).length;

    const preview = {
      title: `MCP: ${request.serverName} / ${request.toolName}`,
      content: argsStr,
      details: [
        `Server: ${request.serverName} (${request.serverId})`,
        `Tool: ${request.toolName}`,
        `Risk: ${riskHint}`,
        `Payload: ${payloadSize} bytes`,
      ],
    };

    const mcpMeta = {
      serverId: request.serverId,
      serverName: request.serverName,
      canonicalId: request.canonicalId,
      riskHint,
      payloadSize,
    };

    const result = await requestApproval(
      request.canonicalId,
      { ...request.args, __mcpMeta: mcpMeta },
      preview
    );

    if (result.approved && request.approvalMode !== 'always') {
      this.addToCache(request.serverId, request.toolName, request.args, request.approvalMode);
    }

    return result;
  }

  private checkCache(serverId: string, toolName: string, args: Record<string, unknown>): boolean {
    const now = Date.now();

    const serverKey = `server:${serverId}`;
    const serverEntry = this.cache.get(serverKey);
    if (serverEntry && serverEntry.expiresAt > now) return true;

    const toolKey = `tool:${serverId}:${toolName}`;
    const toolEntry = this.cache.get(toolKey);
    if (toolEntry && toolEntry.expiresAt > now) return true;

    const argsHash = hashArgs(args);
    const argsKey = `toolArgs:${serverId}:${toolName}:${argsHash}`;
    const argsEntry = this.cache.get(argsKey);
    if (argsEntry && argsEntry.expiresAt > now) return true;

    return false;
  }

  private addToCache(serverId: string, toolName: string, args: Record<string, unknown>, mode: McpServerConfig['approval']): void {
    const ttl = 300000;
    const expiresAt = Date.now() + ttl;

    switch (mode) {
      case 'once-per-server': {
        const key = `server:${serverId}`;
        this.cache.set(key, { scope: 'server', key, expiresAt });
        break;
      }
      case 'once-per-tool': {
        const key = `tool:${serverId}:${toolName}`;
        this.cache.set(key, { scope: 'tool', key, expiresAt });
        break;
      }
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

function hashArgs(args: Record<string, unknown>): string {
  const str = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(str).digest('hex').slice(0, 12);
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(no arguments)';

  const lines: string[] = [];
  for (const [key, value] of entries) {
    const strValue = typeof value === 'string'
      ? (value.length > 100 ? value.slice(0, 100) + '...' : value)
      : JSON.stringify(value);
    lines.push(`  ${key}: ${strValue}`);
  }
  return lines.join('\n');
}