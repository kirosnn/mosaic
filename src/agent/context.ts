import type { ImagePart, TextPart, UserContent } from 'ai';
import { estimateTokensForContent, getDefaultContextBudget } from '../utils/tokenEstimator';
import type { ImageAttachment } from '../utils/images';
import { debugLog } from '../utils/debug';

type SmartRole = 'user' | 'assistant' | 'tool' | 'slash';

export interface SmartContextMessage {
  role: SmartRole;
  content: string;
  images?: ImageAttachment[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  success?: boolean;
}

export interface BuildSmartConversationHistoryOptions {
  messages: SmartContextMessage[];
  includeImages: boolean;
  maxContextTokens?: number;
  provider?: string;
  reserveTokens?: number;
}

interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: UserContent;
  text: string;
  tokens: number;
}

interface SnapshotFact {
  key: string;
  priority: number;
  recency: number;
  text: string;
}

interface SnapshotBuildResult {
  text: string;
  stats: {
    planSteps: number;
    pinnedFacts: number;
    workingSet: number;
    toolMemory: number;
    chars: number;
  };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function contentToText(content: UserContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const part of content as any[]) {
    if (part && part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text);
    }
  }
  return parts.join('\n');
}

function buildUserContent(text: string, images?: ImageAttachment[]): UserContent {
  if (!images || images.length === 0) return text;
  const parts: Array<TextPart | ImagePart> = [];
  parts.push({ type: 'text', text });
  for (const img of images) {
    parts.push({ type: 'image', image: img.data, mimeType: img.mimeType });
  }
  return parts;
}

function detectToolResultError(resultText: string, success?: boolean): boolean {
  if (success === false) return true;
  const lower = resultText.toLowerCase();
  return lower.includes('error') || lower.includes('failed');
}

function getLatestPlanState(messages: SmartContextMessage[]): Array<{ step: string; status: string }> {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool' || msg.toolName !== 'plan') continue;
    const plan = (msg.toolResult as any)?.plan;
    if (!Array.isArray(plan)) continue;
    return plan
      .map((p: any) => ({
        step: typeof p?.step === 'string' ? p.step.trim() : '',
        status: typeof p?.status === 'string' ? p.status : 'pending',
      }))
      .filter((p: { step: string; status: string }) => p.step.length > 0);
  }
  return [];
}

function buildToolMemoryLines(messages: SmartContextMessage[], maxLines: number): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const skipTools = new Set(['title', 'question', 'abort', 'review']);

  for (let i = messages.length - 1; i >= 0 && lines.length < maxLines; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool') continue;
    const toolName = msg.toolName || 'tool';
    if (skipTools.has(toolName)) continue;

    const argsJson = safeJson(msg.toolArgs ?? {});
    const signature = `${toolName}|${argsJson}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    const rawResult = typeof msg.toolResult === 'string'
      ? msg.toolResult
      : msg.toolResult !== undefined
        ? safeJson(msg.toolResult)
        : msg.content;
    const resultText = normalizeWhitespace(rawResult || '');
    const status = detectToolResultError(resultText, msg.success) ? 'FAILED' : 'OK';
    const argsText = truncateText(normalizeWhitespace(argsJson || '{}'), 120);
    const preview = truncateText(resultText || status, 220);
    lines.push(`- [${status}] ${toolName}(${argsText}) => ${preview}`);
  }

  return lines;
}

function buildWorkingSet(messages: SmartContextMessage[], maxFiles: number): string[] {
  const files = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && files.size < maxFiles; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool') continue;
    const args = msg.toolArgs ?? {};
    const path = args.path;
    if (typeof path === 'string' && path.trim()) {
      files.add(path.trim());
    }
    const pattern = args.pattern;
    if (msg.toolName === 'grep' && typeof pattern === 'string' && pattern.trim()) {
      files.add(pattern.trim());
    }
  }
  return [...files];
}

function buildPinnedFacts(messages: SmartContextMessage[], maxLines: number, maxChars: number): string[] {
  const facts: SnapshotFact[] = [];
  const seen = new Set<string>();

  const addFact = (key: string, priority: number, recency: number, text: string) => {
    if (!text.trim() || seen.has(key)) return;
    seen.add(key);
    facts.push({ key, priority, recency, text: truncateText(normalizeWhitespace(text), 260) });
  };

  const latestPlan = getLatestPlanState(messages);
  for (const step of latestPlan) {
    if (step.status === 'completed') continue;
    const marker = step.status === 'in_progress' ? 'IN PROGRESS' : 'PENDING';
    addFact(`plan:${step.step}`, 100, messages.length, `[PLAN ${marker}] ${step.step}`);
  }

  let exploreCount = 0;
  for (let i = messages.length - 1; i >= 0 && exploreCount < 3; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool' || msg.toolName !== 'explore') continue;
    const rawResult = typeof msg.toolResult === 'string'
      ? msg.toolResult
      : msg.toolResult !== undefined
        ? safeJson(msg.toolResult)
        : msg.content;
    const summary = normalizeWhitespace(rawResult || '');
    if (!summary) continue;
    const status = detectToolResultError(summary, msg.success) ? 'FAILED' : 'OK';
    addFact(`explore:${i}:${summary.slice(0, 100)}`, 90, i, `[EXPLORE ${status}] ${summary}`);
    exploreCount++;
  }

  let mutationCount = 0;
  for (let i = messages.length - 1; i >= 0 && mutationCount < 6; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool') continue;
    if (msg.toolName !== 'write' && msg.toolName !== 'edit') continue;
    const path = typeof msg.toolArgs?.path === 'string' ? msg.toolArgs.path.trim() : '';
    const rawResult = typeof msg.toolResult === 'string'
      ? msg.toolResult
      : msg.toolResult !== undefined
        ? safeJson(msg.toolResult)
        : msg.content;
    const summary = normalizeWhitespace(rawResult || '');
    const status = detectToolResultError(summary, msg.success) ? 'FAILED' : 'OK';
    const base = `[${(msg.toolName || 'tool').toUpperCase()} ${status}] ${path || '(unknown path)'}`;
    addFact(`mutation:${msg.toolName}:${path || i}`, 80, i, summary ? `${base} => ${summary}` : base);
    mutationCount++;
  }

  facts.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.recency - a.recency;
  });

  const lines: string[] = [];
  let usedChars = 0;
  for (const fact of facts) {
    if (lines.length >= maxLines) break;
    const line = fact.text;
    if (!line) continue;
    if (usedChars + line.length > maxChars && lines.length > 0) continue;
    lines.push(line);
    usedChars += line.length;
  }

  return lines;
}

function countSmartRoles(messages: SmartContextMessage[]): { user: number; assistant: number; tool: number; slash: number } {
  let user = 0;
  let assistant = 0;
  let tool = 0;
  let slash = 0;
  for (const message of messages) {
    if (message.role === 'user') user++;
    else if (message.role === 'assistant') assistant++;
    else if (message.role === 'tool') tool++;
    else if (message.role === 'slash') slash++;
  }
  return { user, assistant, tool, slash };
}

function summarizeDialogueMessage(message: AgentHistoryMessage, isFirstUser: boolean, isLastUser: boolean): string {
  const cleaned = normalizeWhitespace(message.text);
  if (!cleaned) return `${message.role}: [empty]`;
  if (message.role === 'assistant') {
    const sentence = cleaned.match(/^[^.!?\n]{10,}[.!?]/)?.[0] ?? cleaned;
    return `assistant: ${truncateText(sentence, 220)}`;
  }
  const limit = isFirstUser || isLastUser ? 1000 : 420;
  return `user: ${truncateText(cleaned, limit)}`;
}

function buildMiddleSummary(older: AgentHistoryMessage[], maxChars: number): string {
  if (older.length === 0 || maxChars <= 80) return '';
  const lines: string[] = [];

  let firstUser = -1;
  let lastUser = -1;
  for (let i = 0; i < older.length; i++) {
    if (older[i]?.role === 'user') {
      firstUser = i;
      break;
    }
  }
  for (let i = older.length - 1; i >= 0; i--) {
    if (older[i]?.role === 'user') {
      lastUser = i;
      break;
    }
  }

  let used = 0;
  for (let i = 0; i < older.length; i++) {
    const line = `- ${summarizeDialogueMessage(older[i]!, i === firstUser, i === lastUser)}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length === 0) return '';
  return `Conversation summary (older turns):\n${lines.join('\n')}`;
}

function estimateHistoryTokens(messages: AgentHistoryMessage[]): number {
  let total = 0;
  for (const msg of messages) total += msg.tokens;
  return total;
}

function compactDialogueHistory(messages: AgentHistoryMessage[], budgetTokens: number): AgentHistoryMessage[] {
  if (messages.length <= 2) return messages;
  if (estimateHistoryTokens(messages) <= budgetTokens) return messages;

  const pinnedIndices = new Set<number>();
  if (messages[0]?.role === 'user') pinnedIndices.add(0);

  const pinned = [...pinnedIndices].map((i) => messages[i]!).filter(Boolean);
  const pinnedTokens = estimateHistoryTokens(pinned);

  const recentBudget = Math.max(300, Math.floor(budgetTokens * 0.68));
  const minRecent = 6;
  let recentTokens = 0;
  const recent: AgentHistoryMessage[] = [];
  const recentIndices = new Set<number>();

  for (let i = messages.length - 1; i >= 0; i--) {
    if (pinnedIndices.has(i)) continue;
    const msg = messages[i]!;
    if (recentTokens + msg.tokens > recentBudget && recent.length >= minRecent) break;
    recent.unshift(msg);
    recentTokens += msg.tokens;
    recentIndices.add(i);
  }

  const older: AgentHistoryMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (pinnedIndices.has(i) || recentIndices.has(i)) continue;
    older.push(messages[i]!);
  }

  const summaryBudgetTokens = Math.max(80, budgetTokens - pinnedTokens - recentTokens);
  const summaryText = buildMiddleSummary(older, Math.floor(summaryBudgetTokens * 3.2));
  const summaryMessage = summaryText
    ? [{
      role: 'assistant' as const,
      content: summaryText,
      text: summaryText,
      tokens: estimateTokensForContent(summaryText),
    }]
    : [];

  const compacted = [...pinned, ...summaryMessage, ...recent];
  if (estimateHistoryTokens(compacted) <= budgetTokens) return compacted;

  const fallback = [...recent];
  while (estimateHistoryTokens(fallback) > budgetTokens && fallback.length > 2) {
    fallback.shift();
  }
  return fallback.length > 0 ? fallback : messages.slice(-2);
}

function buildSnapshotMessage(messages: SmartContextMessage[], maxChars: number): SnapshotBuildResult {
  const userMessages = messages.filter((m) => m.role === 'user');
  const originalTask = userMessages[0]?.content ? normalizeWhitespace(userMessages[0].content) : '';
  const currentTask = userMessages[userMessages.length - 1]?.content
    ? normalizeWhitespace(userMessages[userMessages.length - 1]!.content)
    : '';

  const plan = getLatestPlanState(messages);
  const pinnedFacts = buildPinnedFacts(messages, 10, 1800);
  const workingSet = buildWorkingSet(messages, 40);
  const toolMemory = buildToolMemoryLines(messages, 14);

  const sections: string[] = [];
  sections.push('Codebase context snapshot:');

  if (originalTask) {
    sections.push(`Original task:\n- ${truncateText(originalTask, 1200)}`);
  }

  if (currentTask && currentTask !== originalTask) {
    sections.push(`Current user request:\n- ${truncateText(currentTask, 1200)}`);
  }

  if (plan.length > 0) {
    const lines = plan.map((p) => {
      const marker = p.status === 'completed' ? '[DONE]' : p.status === 'in_progress' ? '[IN PROGRESS]' : '[PENDING]';
      return `${marker} ${p.step}`;
    });
    sections.push(`Plan state:\n${lines.join('\n')}`);
  }

  if (pinnedFacts.length > 0) {
    sections.push(`Pinned facts:\n${pinnedFacts.map((line) => `- ${line}`).join('\n')}`);
  }

  if (workingSet.length > 0) {
    sections.push(`Working set files:\n${workingSet.map((file) => `- ${file}`).join('\n')}`);
  }

  if (toolMemory.length > 0) {
    sections.push(`Recent tool outcomes:\n${toolMemory.join('\n')}`);
  }

  sections.push('Use this snapshot to avoid repeated discovery and redundant tool calls.');

  const text = truncateText(sections.join('\n\n'), maxChars);
  return {
    text,
    stats: {
      planSteps: plan.length,
      pinnedFacts: pinnedFacts.length,
      workingSet: workingSet.length,
      toolMemory: toolMemory.length,
      chars: text.length,
    },
  };
}

function buildDialogueHistory(
  messages: SmartContextMessage[],
  includeImages: boolean
): AgentHistoryMessage[] {
  const history: AgentHistoryMessage[] = [];
  let latestImageUserIndex = -1;

  if (includeImages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === 'user' && Array.isArray(msg.images) && msg.images.length > 0) {
        latestImageUserIndex = i;
        break;
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === 'tool' && msg.toolName === 'abort') {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]?.role === 'assistant') {
          const updated = `${contentToText(history[i]!.content)}\n\n[The previous response was interrupted by the user.]`;
          history[i] = {
            role: 'assistant',
            content: updated,
            text: updated,
            tokens: estimateTokensForContent(updated),
          };
          break;
        }
      }
      continue;
    }

    if (msg.role === 'user') {
      const keepImages = includeImages && i === latestImageUserIndex && Array.isArray(msg.images) && msg.images.length > 0;
      const content = keepImages ? buildUserContent(msg.content, msg.images) : msg.content;
      const text = contentToText(content);
      history.push({
        role: 'user',
        content,
        text,
        tokens: estimateTokensForContent(text),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = msg.content || '';
      history.push({
        role: 'assistant',
        content: text,
        text,
        tokens: estimateTokensForContent(text),
      });
    }
  }

  return history;
}

export function buildSmartConversationHistory(
  options: BuildSmartConversationHistoryOptions
): Array<{ role: 'user' | 'assistant'; content: UserContent }> {
  const budget = options.maxContextTokens ?? getDefaultContextBudget(options.provider);
  const reserveTokens = options.reserveTokens ?? Math.max(1200, Math.floor(budget * 0.2));
  const historyBudget = Math.max(800, budget - reserveTokens);
  const snapshot = buildSnapshotMessage(options.messages, Math.max(800, Math.floor(historyBudget * 2.2)));
  const snapshotMessage: AgentHistoryMessage[] = snapshot.text
    ? [{
      role: 'assistant',
      content: snapshot.text,
      text: snapshot.text,
      tokens: estimateTokensForContent(snapshot.text),
    }]
    : [];

  const dialogue = buildDialogueHistory(options.messages, options.includeImages);
  const dialogueTokensBefore = estimateHistoryTokens(dialogue);
  const dialogueBudget = Math.max(400, historyBudget - estimateHistoryTokens(snapshotMessage));
  const compactedDialogue = compactDialogueHistory(dialogue, dialogueBudget);
  const dialogueTokensAfter = estimateHistoryTokens(compactedDialogue);

  const combined = [...snapshotMessage, ...compactedDialogue];
  const inputRoles = countSmartRoles(options.messages);
  debugLog(`[context] smartHistory built input={total:${options.messages.length},user:${inputRoles.user},assistant:${inputRoles.assistant},tool:${inputRoles.tool},slash:${inputRoles.slash}} includeImages=${options.includeImages} budgetTokens={max:${budget},reserve:${reserveTokens},history:${historyBudget},dialogue:${dialogueBudget}} snapshot={chars:${snapshot.stats.chars},tokens:${snapshotMessage[0]?.tokens ?? 0},planSteps:${snapshot.stats.planSteps},pinnedFacts:${snapshot.stats.pinnedFacts},workingSet:${snapshot.stats.workingSet},toolOutcomes:${snapshot.stats.toolMemory}} dialogue={beforeMsgs:${dialogue.length},afterMsgs:${compactedDialogue.length},beforeTokens:${dialogueTokensBefore},afterTokens:${dialogueTokensAfter}} outputMessages=${combined.length}`);

  return combined.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}
