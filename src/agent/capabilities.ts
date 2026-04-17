export type AgentCapability =
  | 'read_only_file'
  | 'safe_local_edit'
  | 'shell_read_only'
  | 'shell_execute'
  | 'network'
  | 'install'
  | 'destructive'
  | 'unknown';

export interface CapabilityApprovalDecision {
  capability: AgentCapability;
  requiresApproval: boolean;
  policy: 'auto_allow' | 'configurable' | 'strong_required';
}

const INSTALL_PATTERNS = [
  /\bnpm\s+(install|i|add|uninstall|remove|update|upgrade|publish|link|ci|rebuild|audit\s+fix)\b/i,
  /\byarn\s+(add|remove|up|upgrade|set\s+version|dlx|plugin|publish|link)\b/i,
  /\bpnpm\s+(add|install|i|remove|update|upgrade|publish|link|rebuild)\b/i,
  /\bbun\s+(add|install|i|remove|update|upgrade|publish|link)\b/i,
  /\bpip\s+(install|uninstall|remove|download)\b/i,
  /\bconda\s+(install|remove|update)\b/i,
];

const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\binvoke-webrequest\b/i,
  /\binvoke-restmethod\b/i,
  /\bhttp\b/i,
];

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\bremove-item\b/i,
  /\bmv\b/i,
  /\bmove-item\b/i,
  /\bcp\b/i,
  /\bcopy-item\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bgit\s+(push|commit|add|reset|checkout|switch|merge|rebase|clean)\b/i,
];

export function classifyShellCapability(command: string, readOnly: boolean): AgentCapability {
  const normalized = command.trim();
  if (!normalized) return 'unknown';
  if (readOnly) return 'shell_read_only';
  if (INSTALL_PATTERNS.some((pattern) => pattern.test(normalized))) return 'install';
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(normalized))) return 'network';
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'destructive';
  return 'shell_execute';
}

export function classifyToolCapability(
  toolName: string,
  options?: { shellReadOnly?: boolean; mcpRiskHint?: 'read' | 'write' | 'execute' | 'network' | 'unknown' },
): AgentCapability {
  if (toolName === 'read' || toolName === 'glob' || toolName === 'grep' || toolName === 'list') {
    return 'read_only_file';
  }
  if (toolName === 'write' || toolName === 'edit') {
    return 'safe_local_edit';
  }
  if (toolName === 'bash') {
    return options?.shellReadOnly ? 'shell_read_only' : 'shell_execute';
  }
  if (toolName.startsWith('mcp__')) {
    if (options?.mcpRiskHint === 'read') return 'read_only_file';
    if (options?.mcpRiskHint === 'write') return 'safe_local_edit';
    if (options?.mcpRiskHint === 'network') return 'network';
    if (options?.mcpRiskHint === 'execute') return 'shell_execute';
  }
  return 'unknown';
}

export function resolveCapabilityApproval(capability: AgentCapability, approvalsEnabled: boolean): CapabilityApprovalDecision {
  if (capability === 'read_only_file') {
    return { capability, requiresApproval: false, policy: 'auto_allow' };
  }
  if (capability === 'shell_read_only') {
    return { capability, requiresApproval: false, policy: 'auto_allow' };
  }
  if (capability === 'safe_local_edit' || capability === 'shell_execute') {
    return { capability, requiresApproval: approvalsEnabled, policy: 'configurable' };
  }
  if (capability === 'network' || capability === 'install' || capability === 'destructive' || capability === 'unknown') {
    return { capability, requiresApproval: true, policy: 'strong_required' };
  }
  return { capability, requiresApproval: approvalsEnabled, policy: 'configurable' };
}
