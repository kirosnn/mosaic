import { resolveCapabilityApproval } from './capabilities';
import { getTaskModeLabel, type TaskMode } from './taskMode';
import { INTERNAL_TOOL_NAMES } from './tools/internalToolNames';
import { getLightweightRoute, readConfig, shouldRequireApprovals } from '../utils/config';
import { getActiveSkillsSnapshot, getOneShotSkillIds } from '../utils/skills';

export interface AssistantCapabilitySnapshot {
  lightweightRoute: {
    provider: string;
    model: string;
  } | null;
  approvalsEnabled: boolean;
  modes: Array<{
    mode: TaskMode;
    label: string;
    purpose: string;
  }>;
  internalToolNames: string[];
  mcpToolNames: string[];
  activeSkills: string[];
  oneShotSkillIds: string[];
}

const MODE_PURPOSES: Record<TaskMode, string> = {
  chat: 'Trivial greetings, thanks, and acknowledgements.',
  assistant_capabilities: 'Questions about Mosaic itself: tools, skills, permissions, and limits.',
  environment_config: 'Local machine, app, editor, folder, and MCP configuration outside normal repo-centric work.',
  explore_readonly: 'Read-only repository and git inspection.',
  plan: 'Planning and approach design without implementation.',
  edit: 'Local code and file changes.',
  run: 'Tests, builds, commands, and verification.',
  review: 'Findings-oriented code review.',
};

function summarizeNames(items: string[], maxItems: number): string {
  if (items.length === 0) {
    return 'none';
  }
  const selected = items.slice(0, maxItems);
  const suffix = items.length > selected.length ? ` (+${items.length - selected.length} more)` : '';
  return `${selected.join(', ')}${suffix}`;
}

function getMcpToolNames(): string[] {
  try {
    const { getMcpCatalog, isMcpInitialized } = require('../mcp/index');
    if (!isMcpInitialized()) {
      return [];
    }
    const infos = getMcpCatalog().getMcpToolInfos() as Array<{ safeId: string }>;
    return infos
      .map((info) => info.safeId)
      .filter((name) => typeof name === 'string' && name.trim().length > 0)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function getAssistantCapabilitySnapshot(): AssistantCapabilitySnapshot {
  const config = readConfig();
  const lightweightRoute = config.provider && config.model
    ? getLightweightRoute(config.provider, config.model, { config })
    : null;
  const approvalsEnabled = shouldRequireApprovals();
  const snapshot = getActiveSkillsSnapshot();

  return {
    lightweightRoute: lightweightRoute
      ? { provider: lightweightRoute.providerId, model: lightweightRoute.modelId }
      : null,
    approvalsEnabled,
    modes: (['chat', 'assistant_capabilities', 'environment_config', 'explore_readonly', 'plan', 'edit', 'run', 'review'] as TaskMode[]).map((mode) => ({
      mode,
      label: getTaskModeLabel(mode),
      purpose: MODE_PURPOSES[mode],
    })),
    internalToolNames: [...INTERNAL_TOOL_NAMES].sort((a, b) => a.localeCompare(b)),
    mcpToolNames: getMcpToolNames(),
    activeSkills: snapshot.activeSkills
      .map((skill) => skill.id)
      .sort((a, b) => a.localeCompare(b)),
    oneShotSkillIds: getOneShotSkillIds(),
  };
}

export function buildAssistantCapabilitySummary(snapshotInput?: AssistantCapabilitySnapshot): string {
  const snapshot = snapshotInput ?? getAssistantCapabilitySnapshot();
  const readOnlyApproval = resolveCapabilityApproval('read_only_file', snapshot.approvalsEnabled);
  const shellReadOnlyApproval = resolveCapabilityApproval('shell_read_only', snapshot.approvalsEnabled);
  const editApproval = resolveCapabilityApproval('safe_local_edit', snapshot.approvalsEnabled);
  const shellApproval = resolveCapabilityApproval('shell_execute', snapshot.approvalsEnabled);
  const networkApproval = resolveCapabilityApproval('network', snapshot.approvalsEnabled);

  const lines: string[] = [
    'LOCAL ASSISTANT CAPABILITY SUMMARY',
    'Use this summary as the source of truth. Do not invent extra tools, skills, permissions, or hidden capabilities.',
  ];

  if (snapshot.lightweightRoute) {
    lines.push(`- Lightweight response route: ${snapshot.lightweightRoute.provider}/${snapshot.lightweightRoute.model}`);
  } else {
    lines.push('- Lightweight response route: unavailable');
  }

  lines.push('- Modes:');
  for (const mode of snapshot.modes) {
    lines.push(`  - ${mode.label} (${mode.mode}): ${mode.purpose}`);
  }

  lines.push(`- Internal tools (${snapshot.internalToolNames.length}): ${summarizeNames(snapshot.internalToolNames, 12)}`);
  lines.push(`- MCP tools (${snapshot.mcpToolNames.length}): ${summarizeNames(snapshot.mcpToolNames, 8)}`);
  lines.push(`- Active workspace skills (${snapshot.activeSkills.length}): ${summarizeNames(snapshot.activeSkills, 8)}`);
  lines.push(`- One-shot queued skills (${snapshot.oneShotSkillIds.length}): ${summarizeNames(snapshot.oneShotSkillIds, 6)}`);
  lines.push(`- Repo inspection abilities: read, list, glob, grep, explore, plus read-only git or shell inspection through bash when allowed.`);
  lines.push(`- Local machine abilities: inspect config files, connect tools to local folders or apps, and work outside the launch directory when approvals or review policy allow it.`);
  lines.push(`- Local change abilities: write and edit local files; run shell commands through bash; fetch remote content when explicitly needed.`);
  lines.push(`- Approval model: configurable approvals are currently ${snapshot.approvalsEnabled ? 'ON' : 'OFF'}.`);
  lines.push(`- Approval policy details: read-only file tools=${readOnlyApproval.policy}; read-only shell/git=${shellReadOnlyApproval.policy}; local edits=${editApproval.policy}; shell execution=${shellApproval.policy}; network/install/destructive=${networkApproval.policy}.`);
  lines.push('- Important limitations in this mode: no repo scan, no workspace summary, no file-aware context, and no tool calls for this answer.');
  lines.push('- If the user asks about a specific repository or file, route out of this mode instead of answering from this summary alone.');

  return lines.join('\n');
}
