import { tool, type CoreTool } from 'ai';
import type { McpToolInfo, McpServerConfig } from './types';
import { parseSafeId, isNativeMcpServer } from './types';
import { McpProcessManager } from './processManager';
import { McpApprovalPolicy } from './approvalPolicy';
import { jsonSchemaObjectToZodObject } from './schemaConverter';

function matchGlobList(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === '*') return true;
    if (pattern === name) return true;

    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    if (regex.test(name)) return true;
  }
  return false;
}

export class McpToolCatalog {
  private processManager: McpProcessManager;
  private approvalPolicy: McpApprovalPolicy;
  private configs: McpServerConfig[];
  private exposedTools = new Map<string, CoreTool>();
  private toolInfoMap = new Map<string, McpToolInfo>();
  private safeToCanonical = new Map<string, string>();
  private canonicalToSafe = new Map<string, string>();

  constructor(processManager: McpProcessManager, approvalPolicy: McpApprovalPolicy, configs: McpServerConfig[]) {
    this.processManager = processManager;
    this.approvalPolicy = approvalPolicy;
    this.configs = configs;
  }

  refreshTools(serverId?: string): void {
    if (serverId) {
      this.refreshServerTools(serverId);
    } else {
      for (const config of this.configs) {
        if (config.enabled) {
          this.refreshServerTools(config.id);
        }
      }
    }
  }

  private refreshServerTools(serverId: string): void {
    for (const [safeId, info] of this.toolInfoMap) {
      if (info.serverId === serverId) {
        this.exposedTools.delete(safeId);
        this.toolInfoMap.delete(safeId);
        this.safeToCanonical.delete(safeId);
        this.canonicalToSafe.delete(info.canonicalId);
      }
    }

    const config = this.configs.find(c => c.id === serverId);
    if (!config || !config.enabled) return;

    const rawTools = this.processManager.listTools(serverId);

    for (const toolInfo of rawTools) {
      if (config.tools.deny && config.tools.deny.length > 0) {
        if (matchGlobList(toolInfo.name, config.tools.deny)) continue;
      }

      if (config.tools.allow && config.tools.allow.length > 0) {
        if (!matchGlobList(toolInfo.name, config.tools.allow)) continue;
      }

      const coreTool = this.convertToCoreToolDef(toolInfo, config);
      this.exposedTools.set(toolInfo.safeId, coreTool);
      this.toolInfoMap.set(toolInfo.safeId, toolInfo);
      this.safeToCanonical.set(toolInfo.safeId, toolInfo.canonicalId);
      this.canonicalToSafe.set(toolInfo.canonicalId, toolInfo.safeId);
    }
  }

  private convertToCoreToolDef(toolInfo: McpToolInfo, config: McpServerConfig): CoreTool {
    const schema = toolInfo.inputSchema || { type: 'object', properties: {} };
    const zodParams = jsonSchemaObjectToZodObject(schema as Record<string, unknown>);

    const pm = this.processManager;
    const ap = this.approvalPolicy;
    const serverConfig = config;

    return tool({
      description: toolInfo.description || `MCP tool: ${toolInfo.name} (${config.name})`,
      parameters: zodParams,
      execute: async (args: Record<string, unknown>) => {
        try {
          const effectiveApproval = serverConfig.toolApproval?.[toolInfo.name] ?? serverConfig.approval;
          const approvalResult = await ap.requestMcpApproval({
            serverId: serverConfig.id,
            serverName: serverConfig.name,
            toolName: toolInfo.name,
            canonicalId: toolInfo.canonicalId,
            args,
            approvalMode: effectiveApproval,
          });

          if (!approvalResult.approved) {
            if (approvalResult.customResponse) {
              return {
                error: `OPERATION REJECTED BY USER with custom instructions: "${approvalResult.customResponse}"`,
                userMessage: 'Operation cancelled by user',
              };
            }
            return {
              error: `OPERATION REJECTED BY USER: calling MCP tool ${toolInfo.canonicalId}`,
              userMessage: 'Operation cancelled by user',
            };
          }

          const result = await pm.callTool(serverConfig.id, toolInfo.name, args);

          if (result.isError) {
            return { error: result.content };
          }

          return result.content;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { error: `MCP tool call failed: ${message}` };
        }
      },
    });
  }

  getExposedTools(): Record<string, CoreTool> {
    const result: Record<string, CoreTool> = {};
    for (const [safeId, coreTool] of this.exposedTools) {
      result[safeId] = coreTool;
    }
    return result;
  }

  getMcpToolInfos(): McpToolInfo[] {
    return Array.from(this.toolInfoMap.values());
  }

  getToolInfo(safeId: string): McpToolInfo | null {
    return this.toolInfoMap.get(safeId) || null;
  }

  getSafeIdFromCanonical(canonicalId: string): string | null {
    return this.canonicalToSafe.get(canonicalId) || null;
  }

  getCanonicalFromSafeId(safeId: string): string | null {
    return this.safeToCanonical.get(safeId) || null;
  }

  isMcpTool(toolName: string): boolean {
    return toolName.startsWith('mcp__');
  }

  parseMcpToolName(safeId: string): { serverId: string; toolName: string } | null {
    return parseSafeId(safeId);
  }

  isNative(safeId: string): boolean {
    const parsed = parseSafeId(safeId);
    if (!parsed) return false;
    const config = this.configs.find(c => c.id === parsed.serverId);
    if (config?.native) return true;
    return isNativeMcpServer(parsed.serverId);
  }

  getServerConfig(serverId: string): McpServerConfig | null {
    return this.configs.find(c => c.id === serverId) || null;
  }

  updateConfigs(configs: McpServerConfig[]): void {
    this.configs = configs;
  }

  static mergeTools(internal: Record<string, CoreTool>, mcp: Record<string, CoreTool>): Record<string, CoreTool> {
    return { ...internal, ...mcp };
  }
}