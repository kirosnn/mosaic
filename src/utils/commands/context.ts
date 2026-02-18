import { buildSmartConversationHistory } from '../../agent/context';
import { tools as internalTools } from '../../agent/tools/definitions';
import { DEFAULT_SYSTEM_PROMPT, processSystemPrompt } from '../../agent/prompts/systemPrompt';
import { TOOLS_PROMPT, getToolsPrompt } from '../../agent/prompts/toolsPrompt';
import { getGlobalMemory } from '../../agent/memory';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { isMcpInitialized, getMcpCatalog, getMcpManager } from '../../mcp';
import { loadMcpConfig } from '../../mcp/config';
import { getModelsDevContextLimit, getModelsDevOutputLimit } from '../models';
import { readConfig, getProviderById } from '../config';
import { buildActiveSkillsPromptSection, getActiveSkillsSnapshot, getOneShotSkillIds } from '../skills';
import { estimateTokensForContent, estimateTokensFromText, getDefaultContextBudget } from '../tokenEstimator';
import type { McpServerState, McpToolInfo } from '../../mcp/types';
import type { Command, CommandContextMessage, CommandExecutionContext } from './types';

interface RoleStats {
  count: number;
  tokens: number;
  chars: number;
}

interface ToolUsage {
  name: string;
  count: number;
  ok: number;
  failed: number;
  tokens: number;
}

interface SmartHistoryStats {
  messages: number;
  userMessages: number;
  assistantMessages: number;
  textChars: number;
  tokens: number;
  userTokens: number;
  assistantTokens: number;
  imageParts: number;
}

interface WorkspaceMosaicFile {
  path: string;
  content: string;
  lineCount: number;
  lastModifiedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return formatNumber(value);
}

function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return formatNumber(value);
}

function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0.00';
  return ((part / total) * 100).toFixed(2);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text);
    }
  }

  return parts.join('\n');
}

function countImageParts(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let count = 0;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === 'image') count++;
  }
  return count;
}

function getRoleStats(messages: CommandContextMessage[]): Record<'user' | 'assistant' | 'tool' | 'slash', RoleStats> {
  const stats: Record<'user' | 'assistant' | 'tool' | 'slash', RoleStats> = {
    user: { count: 0, tokens: 0, chars: 0 },
    assistant: { count: 0, tokens: 0, chars: 0 },
    tool: { count: 0, tokens: 0, chars: 0 },
    slash: { count: 0, tokens: 0, chars: 0 },
  };

  for (const message of messages) {
    const role = message.role;
    const chars = (message.content || '').length;
    const tokens = estimateTokensForContent(
      message.content || '',
      role === 'assistant' ? message.thinkingContent : undefined
    );
    stats[role].count += 1;
    stats[role].tokens += tokens;
    stats[role].chars += chars;
  }

  return stats;
}

function getToolUsage(messages: CommandContextMessage[]): ToolUsage[] {
  const usageMap = new Map<string, ToolUsage>();

  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const name = message.toolName || 'tool';
    const tokens = estimateTokensForContent(message.content || '');
    const knownFailure = message.success === false;
    const inferredFailure = normalizeText(message.content || '').toLowerCase().includes('error')
      || normalizeText(message.content || '').toLowerCase().includes('failed');
    const failed = knownFailure || inferredFailure;

    const existing = usageMap.get(name);
    if (existing) {
      existing.count += 1;
      existing.tokens += tokens;
      if (failed) existing.failed += 1;
      else existing.ok += 1;
      continue;
    }

    usageMap.set(name, {
      name,
      count: 1,
      ok: failed ? 0 : 1,
      failed: failed ? 1 : 0,
      tokens,
    });
  }

  return Array.from(usageMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.tokens - a.tokens;
  });
}

function formatTimestamp(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return 'never';
  return new Date(value).toISOString();
}

function collectMcpTools(): McpToolInfo[] {
  if (!isMcpInitialized()) return [];
  try {
    return getMcpCatalog().getMcpToolInfos();
  } catch {
    return [];
  }
}

function getSmartHistoryStats(history: Array<{ role: 'user' | 'assistant'; content: unknown }>): SmartHistoryStats {
  let userMessages = 0;
  let assistantMessages = 0;
  let textChars = 0;
  let tokens = 0;
  let userTokens = 0;
  let assistantTokens = 0;
  let imageParts = 0;

  for (const message of history) {
    if (message.role === 'user') userMessages += 1;
    else assistantMessages += 1;
    const text = contentToText(message.content);
    const messageImageParts = countImageParts(message.content);
    const messageTokens = estimateTokensForContent(text);
    textChars += text.length;
    imageParts += messageImageParts;
    tokens += messageTokens;
    if (message.role === 'user') userTokens += messageTokens;
    else assistantTokens += messageTokens;
  }

  return {
    messages: history.length,
    userMessages,
    assistantMessages,
    textChars,
    tokens,
    userTokens,
    assistantTokens,
    imageParts,
  };
}

function buildMcpServerLines(
  mcpTools: McpToolInfo[],
  statesByServer: Map<string, McpServerState>,
  includeRuntime: boolean
): string[] {
  const configs = loadMcpConfig();
  const toolCountByServer = new Map<string, number>();
  for (const tool of mcpTools) {
    toolCountByServer.set(tool.serverId, (toolCountByServer.get(tool.serverId) ?? 0) + 1);
  }

  const lines: string[] = [];
  for (const config of configs.sort((a, b) => a.id.localeCompare(b.id))) {
    const state = statesByServer.get(config.id);
    const toolsFromCatalog = toolCountByServer.get(config.id) ?? 0;
    const stateToolCount = state?.toolCount ?? 0;
    const effectiveToolCount = toolsFromCatalog > 0 ? toolsFromCatalog : stateToolCount;
    const status = state?.status ?? (config.enabled ? 'not-started' : 'disabled');
    const base = `${config.id} | status=${status} | enabled=${config.enabled} | native=${Boolean(config.native)} | autostart=${config.autostart} | approval=${config.approval} | tools=${effectiveToolCount}`;
    lines.push(base);
    lines.push(`  command=${config.command} ${(config.args || []).join(' ')}`.trim());
    lines.push(`  cwd=${config.cwd || 'workspace'} | rpm=${config.limits.maxCallsPerMinute} | payload=${formatNumber(config.limits.maxPayloadBytes)} bytes | callTimeout=${config.timeouts.call}ms | initTimeout=${config.timeouts.initialize}ms`);
    lines.push(`  logs=persist:${config.logs.persist} buffer:${config.logs.bufferSize} path:${config.logs.path || 'none'} | allow=${(config.tools.allow || []).join(', ') || '*'} | deny=${(config.tools.deny || []).join(', ') || 'none'}`);
    if (includeRuntime && state) {
      lines.push(`  runtime initLatency=${formatOptionalNumber(state.initLatencyMs)}ms | lastCallAt=${formatTimestamp(state.lastCallAt)} | lastError=${state.lastError || 'none'}`);
    }
  }

  if (configs.length === 0) {
    lines.push('No MCP server configuration found.');
  }

  return lines;
}

function buildRecentMcpLogLines(includeRuntime: boolean): string[] {
  if (!includeRuntime) return ['MCP runtime logs unavailable (MCP not initialized).'];

  const manager = getMcpManager();
  const configs = loadMcpConfig();
  const lines: string[] = [];

  for (const config of configs.sort((a, b) => a.id.localeCompare(b.id))) {
    const logs = manager.getLogs(config.id);
    let info = 0;
    let error = 0;
    let debug = 0;
    for (const entry of logs) {
      if (entry.level === 'info') info += 1;
      else if (entry.level === 'error') error += 1;
      else debug += 1;
    }
    const latest = logs[logs.length - 1];
    const latestText = latest ? `${new Date(latest.timestamp).toISOString()} [${latest.level}] ${truncate(latest.message, 180)}` : 'none';
    lines.push(`${config.id}: total=${logs.length} info=${info} error=${error} debug=${debug} latest=${latestText}`);
  }

  if (lines.length === 0) {
    lines.push('No MCP logs available.');
  }

  return lines;
}

function getContextSource(configured: number | null, modelLimit: number | null): { source: string; value: number } {
  if (typeof configured === 'number' && configured > 0) {
    return { source: 'config.maxContextTokens', value: configured };
  }
  if (typeof modelLimit === 'number' && modelLimit > 0) {
    return { source: 'models.dev limit.context', value: modelLimit };
  }
  return { source: 'provider default budget', value: 0 };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isMosaicPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === 'mosaic.md' || normalized.endsWith('/mosaic.md');
}

function getWorkspaceMosaicFile(): WorkspaceMosaicFile | null {
  const workspace = process.cwd();
  const candidates = ['MOSAIC.md', 'mosaic.md'];

  for (const candidate of candidates) {
    const fullPath = join(workspace, candidate);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath, 'utf8');
      const stats = statSync(fullPath);
      return {
        path: candidate,
        content,
        lineCount: content.split('\n').length,
        lastModifiedAt: stats.mtimeMs,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function buildUsageBarSegments(used: number, buffer: number, total: number, width: number): { usedCells: number; bufferCells: number; freeCells: number } {
  if (!Number.isFinite(total) || total <= 0 || width <= 0) {
    return { usedCells: 0, bufferCells: 0, freeCells: Math.max(0, width) };
  }
  const usedRatio = clampNumber(used / total, 0, 1);
  const bufferRatio = clampNumber(buffer / total, 0, 1);
  let usedCells = Math.round(usedRatio * width);
  let bufferCells = Math.round(bufferRatio * width);
  if (usedCells + bufferCells > width) {
    const overflow = usedCells + bufferCells - width;
    if (bufferCells >= overflow) bufferCells -= overflow;
    else {
      usedCells = Math.max(0, usedCells - (overflow - bufferCells));
      bufferCells = 0;
    }
  }
  const freeCells = Math.max(0, width - usedCells - bufferCells);
  return { usedCells, bufferCells, freeCells };
}

export const contextCommand: Command = {
  name: 'context',
  description: 'Show detailed context budget and usage diagnostics',
  usage: '/context [--full]',
  aliases: ['ctx'],
  execute: async (args: string[], _fullCommand: string, context?: CommandExecutionContext) => {
    const showFull = args.includes('--full') || args.includes('-f');
    const config = readConfig();
    const provider = config.provider || 'not-configured';
    const providerLabel = config.provider ? (getProviderById(config.provider)?.name || config.provider) : 'Not configured';
    const model = config.model || 'not-configured';

    let modelContextLimit: number | null = null;
    let modelOutputLimit: number | null = null;
    if (config.provider && config.model) {
      modelContextLimit = await getModelsDevContextLimit(config.provider, config.model);
      modelOutputLimit = await getModelsDevOutputLimit(config.provider, config.model);
    }

    const configuredContextLimit = (typeof config.maxContextTokens === 'number' && config.maxContextTokens > 0)
      ? config.maxContextTokens
      : null;
    const fallbackBudget = getDefaultContextBudget(config.provider);
    const resolvedContextLimit = configuredContextLimit ?? modelContextLimit ?? fallbackBudget;
    const sourceInfo = getContextSource(configuredContextLimit, modelContextLimit);
    const sourceLabel = sourceInfo.value > 0 ? sourceInfo.source : 'provider default budget';

    const reserveTokens = Math.max(1200, Math.floor(resolvedContextLimit * 0.2));
    const smartHistoryBudget = Math.max(800, resolvedContextLimit - reserveTokens);

    const mcpTools = collectMcpTools();
    const toolsPromptBase = TOOLS_PROMPT;
    const toolsPromptWithMcp = getToolsPrompt(mcpTools.length > 0 ? mcpTools : undefined);
    const rawSystemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const processedSystemPromptNoTools = processSystemPrompt(rawSystemPrompt, false);
    const processedSystemPromptFull = processSystemPrompt(rawSystemPrompt, true, mcpTools.length > 0 ? mcpTools : undefined);
    const activeSkillsSnapshot = getActiveSkillsSnapshot();
    const oneShotSkillIds = getOneShotSkillIds();
    const activeSkillsPrompt = buildActiveSkillsPromptSection();

    const runtimeMessages = context?.messages ?? [];
    const roleStats = getRoleStats(runtimeMessages);
    const totalMessageTokens = roleStats.user.tokens + roleStats.assistant.tokens + roleStats.tool.tokens + roleStats.slash.tokens;
    const totalMessageChars = roleStats.user.chars + roleStats.assistant.chars + roleStats.tool.chars + roleStats.slash.chars;
    let messagesWithImages = 0;
    let totalImages = 0;
    for (const message of runtimeMessages) {
      const imageCount = Array.isArray(message.images) ? message.images.length : 0;
      if (imageCount > 0) {
        messagesWithImages += 1;
        totalImages += imageCount;
      }
    }
    const toolUsage = getToolUsage(runtimeMessages);

    const smartHistory = buildSmartConversationHistory({
      messages: runtimeMessages.map((message) => ({
        role: message.role,
        content: message.content,
        images: message.images,
        toolName: message.toolName,
        toolArgs: message.toolArgs,
        toolResult: message.toolResult,
        success: message.success,
      })),
      includeImages: Boolean(context?.imagesSupported),
      maxContextTokens: resolvedContextLimit,
      provider: config.provider,
      reserveTokens,
    });
    const smartStats = getSmartHistoryStats(smartHistory);

    const memory = getGlobalMemory();
    const memoryStats = memory.getStats();
    const memoryIndexText = memory.buildMemoryContext(5000);
    const memoryIndexTokens = memoryIndexText ? estimateTokensFromText(memoryIndexText) : 0;
    const memoryKnownPaths = memory.getKnownFilePaths();
    const workspaceMosaicFile = getWorkspaceMosaicFile();

    const systemPromptTokensRaw = estimateTokensFromText(rawSystemPrompt);
    const systemPromptTokensNoTools = estimateTokensFromText(processedSystemPromptNoTools);
    const toolsPromptBaseTokens = estimateTokensFromText(toolsPromptBase);
    const toolsPromptWithMcpTokens = estimateTokensFromText(toolsPromptWithMcp);
    const systemPromptTokensFull = estimateTokensFromText(processedSystemPromptFull);
    const skillsPromptTokens = estimateTokensFromText(activeSkillsPrompt);
    const mcpCatalogTokens = estimateTokensFromText(
      mcpTools.map((tool) => `${tool.safeId} ${tool.description || ''}`).join('\n')
    );

    const categorySystemPrompt = Math.max(0, (systemPromptTokensNoTools + 8) - skillsPromptTokens);
    const categorySkills = skillsPromptTokens;
    const categorySystemTools = toolsPromptWithMcpTokens;
    const categoryMemoryIndex = memoryIndexTokens;
    const categoryMcpCatalog = mcpCatalogTokens;
    const categoryUserPrompt = smartStats.userTokens;
    const categoryMessages = Math.max(0, smartStats.tokens - categoryUserPrompt);
    const usedWithoutBuffer = categorySystemPrompt + categorySkills + categorySystemTools + categoryMemoryIndex + categoryMcpCatalog + categoryMessages;
    const usedWithoutBufferWithUserPrompt = usedWithoutBuffer + categoryUserPrompt;
    const usedForBar = Math.min(resolvedContextLimit, usedWithoutBufferWithUserPrompt);
    const effectiveBuffer = Math.max(0, Math.min(reserveTokens, resolvedContextLimit - usedForBar));
    const freeSpaceTokens = Math.max(0, resolvedContextLimit - usedForBar - effectiveBuffer);
    const usagePercent = formatPercent(usedForBar, resolvedContextLimit);
    const overflowTokens = Math.max(0, usedWithoutBufferWithUserPrompt - resolvedContextLimit);

    const usageBar = buildUsageBarSegments(usedForBar, effectiveBuffer, resolvedContextLimit, 40);
    const internalToolNames = Object.keys(internalTools).sort((a, b) => a.localeCompare(b));
    const mcpToolNames = mcpTools.map((tool) => tool.safeId).sort((a, b) => a.localeCompare(b));

    const mcpRuntime = isMcpInitialized();
    const statesByServer = new Map<string, McpServerState>();
    if (mcpRuntime) {
      const states = getMcpManager().getAllStates();
      for (const [id, state] of states) {
        statesByServer.set(id, state);
      }
    }

    const mcpConfigs = loadMcpConfig();
    const enabledMcpServers = mcpConfigs.filter((server) => server.enabled).length;
    const runningMcpServers = Array.from(statesByServer.values()).filter((state) => state.status === 'running').length;
    const erroredMcpServers = Array.from(statesByServer.values()).filter((state) => state.status === 'error').length;

    const lines: string[] = [];
    lines.push('[CTX_HEADER]|Context Usage');
    lines.push(`[CTX_MODEL]|${model}|${formatCompactTokens(usedForBar)}|${formatCompactTokens(resolvedContextLimit)}|${usagePercent}`);
    lines.push(`[CTX_BAR]|${usageBar.usedCells}|${usageBar.bufferCells}|${usageBar.freeCells}|${usagePercent}`);
    lines.push('[CTX_SECTION]|Estimated usage by category');
    lines.push(`[CTX_CAT|SP]|System prompt|${formatCompactTokens(categorySystemPrompt)}|${formatPercent(categorySystemPrompt, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|SK]|Skills|${formatCompactTokens(categorySkills)}|${formatPercent(categorySkills, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|ST]|System tools|${formatCompactTokens(categorySystemTools)}|${formatPercent(categorySystemTools, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|MI]|Memory index|${formatCompactTokens(categoryMemoryIndex)}|${formatPercent(categoryMemoryIndex, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|MC]|MCP catalog|${formatCompactTokens(categoryMcpCatalog)}|${formatPercent(categoryMcpCatalog, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|UP]|User prompt|${formatCompactTokens(categoryUserPrompt)}|${formatPercent(categoryUserPrompt, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|MS]|Messages|${formatCompactTokens(categoryMessages)}|${formatPercent(categoryMessages, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|FS]|Free space|${formatCompactTokens(freeSpaceTokens)}|${formatPercent(freeSpaceTokens, resolvedContextLimit)}`);
    lines.push(`[CTX_CAT|AB]|Autocompact buffer|${formatCompactTokens(effectiveBuffer)}|${formatPercent(effectiveBuffer, resolvedContextLimit)}`);
    if (overflowTokens > 0) {
      lines.push(`[CTX_NOTE]|Context overflow estimated: ${formatCompactTokens(overflowTokens)} tokens over max. Compaction is required.`);
    }

    lines.push('');
    lines.push('[CTX_SECTION]|Memory files · /memory');
    const recentMemoryFiles = [...memoryKnownPaths]
      .map((path) => ({ path, entry: memory.getFileEntry(path) }))
      .filter((row): row is { path: string; entry: NonNullable<ReturnType<typeof memory.getFileEntry>> } => Boolean(row.entry))
      .sort((a, b) => b.entry.lastReadAt - a.entry.lastReadAt)
      .slice(0, 8);
    const hasMosaicInRecentFiles = recentMemoryFiles.some((file) => isMosaicPath(file.path));
    const shouldShowWorkspaceMosaic = Boolean(workspaceMosaicFile) && !hasMosaicInRecentFiles;
    if (recentMemoryFiles.length === 0 && !shouldShowWorkspaceMosaic) {
      lines.push('[CTX_NOTE]|No memory files yet');
    } else {
      for (const file of recentMemoryFiles) {
        const approxTokens = Math.max(1, estimateTokensFromText(file.entry.summary));
        lines.push(`[CTX_MEM]|${file.path}|${formatCompactTokens(approxTokens)}`);
      }
      if (shouldShowWorkspaceMosaic && workspaceMosaicFile) {
        const approxTokens = Math.max(1, estimateTokensFromText(workspaceMosaicFile.content));
        lines.push(`[CTX_MEM]|${workspaceMosaicFile.path}|${formatCompactTokens(approxTokens)}`);
      }
    }

    if (!showFull) {
      lines.push('');
      lines.push('[CTX_NOTE]|Use /context --full for complete diagnostics');
      return {
        success: true,
        content: lines.join('\n'),
        shouldAddToHistory: false,
      };
    }

    lines.push('');
    lines.push('Model and Limits');
    lines.push(`- Provider: ${providerLabel} (${provider})`);
    lines.push(`- Model: ${model}`);
    lines.push(`- Context max tokens (resolved): ${formatNumber(resolvedContextLimit)} (source: ${sourceLabel})`);
    lines.push(`- Context max tokens (config): ${formatOptionalNumber(configuredContextLimit)}`);
    lines.push(`- Context max tokens (models.dev): ${formatOptionalNumber(modelContextLimit)}`);
    lines.push(`- Context max tokens (provider fallback): ${formatNumber(fallbackBudget)}`);
    lines.push(`- Output max tokens (models.dev): ${formatOptionalNumber(modelOutputLimit)}`);
    lines.push(`- Max steps: ${formatNumber(config.maxSteps ?? 100)}`);
    lines.push(`- Reserve tokens for reply/tools: ${formatNumber(reserveTokens)}`);
    lines.push(`- Smart history budget: ${formatNumber(smartHistoryBudget)}`);

    lines.push('');
    lines.push('Prompt Components');
    lines.push(`- Raw system prompt: chars=${formatNumber(rawSystemPrompt.length)} tokens~${formatNumber(systemPromptTokensRaw)}`);
    lines.push(`- Processed system prompt (without tools): chars=${formatNumber(processedSystemPromptNoTools.length)} tokens~${formatNumber(systemPromptTokensNoTools)}`);
    lines.push(`- Active skills: persistent=${formatNumber(activeSkillsSnapshot.activeSkills.length)} oneShot=${formatNumber(oneShotSkillIds.length)} tokens~${formatNumber(skillsPromptTokens)}`);
    lines.push(`- Tools prompt base: chars=${formatNumber(toolsPromptBase.length)} tokens~${formatNumber(toolsPromptBaseTokens)}`);
    lines.push(`- Tools prompt with MCP: chars=${formatNumber(toolsPromptWithMcp.length)} tokens~${formatNumber(toolsPromptWithMcpTokens)}`);
    lines.push(`- Processed system prompt (final): chars=${formatNumber(processedSystemPromptFull.length)} tokens~${formatNumber(systemPromptTokensFull)}`);
    if (activeSkillsSnapshot.activeSkills.length > 0 || oneShotSkillIds.length > 0) {
      const allIds = [
        ...activeSkillsSnapshot.activeSkills.map((skill) => skill.id),
        ...oneShotSkillIds,
      ];
      const uniqueIds = Array.from(new Set(allIds));
      lines.push(`- Active skill ids: ${uniqueIds.join(', ')}`);
    }

    lines.push('');
    lines.push('Tool Inventory');
    lines.push(`- Internal tools: ${formatNumber(internalToolNames.length)}`);
    lines.push(`- MCP tools exposed: ${formatNumber(mcpToolNames.length)}`);
    lines.push(`- Total callable tools: ${formatNumber(internalToolNames.length + mcpToolNames.length)}`);
    lines.push(`- Internal tool names: ${internalToolNames.join(', ') || 'none'}`);
    lines.push(`- MCP tool names: ${mcpToolNames.join(', ') || 'none'}`);

    lines.push('');
    lines.push('Memory Snapshot');
    lines.push(`- Memory stats: files=${formatNumber(memoryStats.files)} searches=${formatNumber(memoryStats.searches)} toolCalls=${formatNumber(memoryStats.toolCalls)} turns=${formatNumber(memoryStats.turn)}`);
    lines.push(`- Memory index estimated tokens: ${formatNumber(categoryMemoryIndex)}`);
    lines.push(`- Memory known files: ${formatNumber(memoryKnownPaths.length)}`);
    const hasMosaicInRecentFull = recentMemoryFiles.some((file) => isMosaicPath(file.path));
    const shouldShowWorkspaceMosaicInFull = Boolean(workspaceMosaicFile) && !hasMosaicInRecentFull;
    if (recentMemoryFiles.length > 0 || shouldShowWorkspaceMosaicInFull) {
      lines.push('- Recent memory files:');
      for (const file of recentMemoryFiles) {
        lines.push(`  ${file.path}: ${file.entry.lineCount} lines, read ${file.entry.readCount}x, last=${formatTimestamp(file.entry.lastReadAt)}`);
      }
      if (shouldShowWorkspaceMosaicInFull && workspaceMosaicFile) {
        lines.push(`  ${workspaceMosaicFile.path}: ${workspaceMosaicFile.lineCount} lines, read 0x, last=${formatTimestamp(workspaceMosaicFile.lastModifiedAt)}`);
      }
    } else {
      lines.push('- Recent memory files: none');
    }

    lines.push('');
    lines.push('MCP Configuration and Runtime');
    lines.push(`- MCP initialized: ${mcpRuntime}`);
    lines.push(`- MCP servers configured: ${formatNumber(mcpConfigs.length)} (enabled=${formatNumber(enabledMcpServers)})`);
    lines.push(`- MCP runtime servers: running=${formatNumber(runningMcpServers)} error=${formatNumber(erroredMcpServers)} knownStates=${formatNumber(statesByServer.size)}`);
    lines.push(`- MCP tools in catalog: ${formatNumber(mcpTools.length)}`);
    lines.push('- MCP servers detail:');
    for (const line of buildMcpServerLines(mcpTools, statesByServer, mcpRuntime)) {
      lines.push(`  ${line}`);
    }
    lines.push('- MCP recent logs by server:');
    for (const line of buildRecentMcpLogLines(mcpRuntime)) {
      lines.push(`  ${line}`);
    }

    lines.push('');
    lines.push('Runtime Conversation');
    lines.push(`- isProcessing: ${Boolean(context?.isProcessing)}`);
    lines.push(`- messages total: ${formatNumber(runtimeMessages.length)} chars=${formatNumber(totalMessageChars)} tokens~${formatNumber(totalMessageTokens)}`);
    lines.push(`- role=user count=${formatNumber(roleStats.user.count)} chars=${formatNumber(roleStats.user.chars)} tokens~${formatNumber(roleStats.user.tokens)}`);
    lines.push(`- role=assistant count=${formatNumber(roleStats.assistant.count)} chars=${formatNumber(roleStats.assistant.chars)} tokens~${formatNumber(roleStats.assistant.tokens)}`);
    lines.push(`- role=tool count=${formatNumber(roleStats.tool.count)} chars=${formatNumber(roleStats.tool.chars)} tokens~${formatNumber(roleStats.tool.tokens)}`);
    lines.push(`- role=slash count=${formatNumber(roleStats.slash.count)} chars=${formatNumber(roleStats.slash.chars)} tokens~${formatNumber(roleStats.slash.tokens)}`);
    lines.push(`- images supported: ${Boolean(context?.imagesSupported)} | messages with images=${formatNumber(messagesWithImages)} | total images=${formatNumber(totalImages)}`);
    lines.push(`- currentTokens (UI): ${formatOptionalNumber(context?.currentTokens)}`);
    lines.push(`- lastPromptTokens (UI): ${formatOptionalNumber(context?.lastPromptTokens)}`);
    if (context?.tokenBreakdown) {
      lines.push(`- tokenBreakdown (UI): prompt=${formatNumber(context.tokenBreakdown.prompt)} reasoning=${formatNumber(context.tokenBreakdown.reasoning)} output=${formatNumber(context.tokenBreakdown.output)} tools=${formatNumber(context.tokenBreakdown.tools)}`);
    } else {
      lines.push('- tokenBreakdown (UI): unavailable');
    }
    lines.push('- Tool usage from runtime messages:');
    if (toolUsage.length === 0) {
      lines.push('  none');
    } else {
      for (const usage of toolUsage) {
        lines.push(`  ${usage.name}: calls=${formatNumber(usage.count)} ok=${formatNumber(usage.ok)} failed=${formatNumber(usage.failed)} tokens~${formatNumber(usage.tokens)}`);
      }
    }

    lines.push('');
    lines.push('Smart Conversation History (Sent to Model)');
    lines.push(`- messages: total=${formatNumber(smartStats.messages)} user=${formatNumber(smartStats.userMessages)} assistant=${formatNumber(smartStats.assistantMessages)}`);
    lines.push(`- payload text chars=${formatNumber(smartStats.textChars)} tokens~${formatNumber(smartStats.tokens)} imageParts=${formatNumber(smartStats.imageParts)}`);
    lines.push(`- estimated total input tokens: ${formatNumber(usedWithoutBufferWithUserPrompt)} (${formatPercent(usedWithoutBufferWithUserPrompt, resolvedContextLimit)}%)`);
    lines.push(`- estimated remaining context tokens (excluding buffer): ${formatNumber(Math.max(0, resolvedContextLimit - usedForBar))}`);

    lines.push('');
    lines.push('Top Smart History Entries (first 8)');
    const previewCount = Math.min(8, smartHistory.length);
    for (let i = 0; i < previewCount; i++) {
      const msg = smartHistory[i]!;
      const text = normalizeText(contentToText(msg.content));
      const tokens = estimateTokensForContent(text);
      const images = countImageParts(msg.content);
      const prefix = `${i + 1}. role=${msg.role} tokens~${formatNumber(tokens)} chars=${formatNumber(text.length)} imageParts=${formatNumber(images)}`;
      lines.push(`- ${prefix}`);
      lines.push(`  ${truncate(text, 280) || '[empty]'}`);
    }
    if (smartHistory.length > previewCount) {
      lines.push(`- ... ${formatNumber(smartHistory.length - previewCount)} more messages not shown in preview`);
    }

    return {
      success: true,
      content: lines.join('\n'),
      shouldAddToHistory: false,
    };
  },
};
