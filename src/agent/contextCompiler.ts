import type { SmartContextMessage } from './context';
import type { RepositorySummary } from './repoScan';
import { formatRepositorySummary } from './repoScan';
import { getTaskModeLabel, type TaskModeDecision } from './taskMode';

export interface CompiledContextResult {
  text: string;
  stats: {
    repoRoots: number;
    importantFiles: number;
    workingSet: number;
    findings: number;
    unknowns: number;
    chars: number;
  };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractPlanLines(messages: SmartContextMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'tool' || message.toolName !== 'plan') continue;
    const plan = (message.toolResult as { plan?: Array<{ step?: string; status?: string }> } | undefined)?.plan;
    if (!Array.isArray(plan)) continue;
    return plan
      .map((entry) => {
        const step = typeof entry?.step === 'string' ? entry.step.trim() : '';
        const status = typeof entry?.status === 'string' ? entry.status : 'pending';
        if (!step) return '';
        const marker = status === 'completed' ? '[DONE]' : status === 'in_progress' ? '[IN PROGRESS]' : '[PENDING]';
        return `${marker} ${step}`;
      })
      .filter(Boolean);
  }
  return [];
}

function buildWorkingSet(messages: SmartContextMessage[], maxItems: number): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (let i = messages.length - 1; i >= 0 && values.length < maxItems; i--) {
    const message = messages[i];
    if (!message || message.role !== 'tool') continue;
    const path = typeof message.toolArgs?.path === 'string' ? message.toolArgs.path.trim() : '';
    if (path && !seen.has(path)) {
      seen.add(path);
      values.push(path);
    }
  }

  return values.reverse();
}

function buildFindings(messages: SmartContextMessage[], maxItems: number): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  const skipTools = new Set(['title', 'question', 'plan', 'review', 'abort']);

  for (let i = messages.length - 1; i >= 0 && findings.length < maxItems; i--) {
    const message = messages[i];
    if (!message || message.role !== 'tool' || skipTools.has(message.toolName || '')) continue;
    if (message.success === false) continue;

    const toolName = message.toolName || 'tool';
    const args = truncateText(normalizeWhitespace(safeStringify(message.toolArgs ?? {})), 80);
    const result = truncateText(normalizeWhitespace(safeStringify(message.toolResult ?? message.content)), 180);
    const signature = `${toolName}:${args}:${result}`;
    if (seen.has(signature) || !result) continue;
    seen.add(signature);
    findings.push(`[${toolName}] ${result}`);
  }

  return findings.reverse();
}

function buildUnknowns(messages: SmartContextMessage[], maxItems: number): string[] {
  const unknowns: string[] = [];
  const seen = new Set<string>();

  for (let i = messages.length - 1; i >= 0 && unknowns.length < maxItems; i--) {
    const message = messages[i];
    if (!message || message.role !== 'tool' || message.success !== false) continue;
    const toolName = message.toolName || 'tool';
    const result = truncateText(normalizeWhitespace(safeStringify(message.toolResult ?? message.content)), 160);
    if (!result || seen.has(`${toolName}:${result}`)) continue;
    seen.add(`${toolName}:${result}`);
    unknowns.push(`${toolName}: ${result}`);
  }

  return unknowns.reverse();
}

export function compileContextSnapshot(
  messages: SmartContextMessage[],
  taskMode: TaskModeDecision,
  repoSummary: RepositorySummary,
  maxChars: number,
): CompiledContextResult {
  const userMessages = messages.filter((message) => message.role === 'user');
  const originalTask = normalizeWhitespace(userMessages[0]?.content || '');
  const currentTask = normalizeWhitespace(userMessages[userMessages.length - 1]?.content || '');
  const planLines = extractPlanLines(messages);
  const workingSet = buildWorkingSet(messages, 12);
  const findings = buildFindings(messages, 8);
  const unknowns = buildUnknowns(messages, 5);
  const repoMap = formatRepositorySummary(repoSummary, 1200);

  const sections: string[] = [];
  sections.push(`Task mode: ${getTaskModeLabel(taskMode.mode)} (${taskMode.reason})`);

  if (originalTask) {
    sections.push(`Original task:\n- ${truncateText(originalTask, 500)}`);
  }

  if (currentTask && currentTask !== originalTask) {
    sections.push(`Current request:\n- ${truncateText(currentTask, 500)}`);
  }

  sections.push(`Repo map:\n${repoMap}`);

  if (planLines.length > 0 && taskMode.mode !== 'explore_readonly') {
    sections.push(`Plan state:\n${planLines.join('\n')}`);
  }

  if (workingSet.length > 0) {
    sections.push(`Working set:\n${workingSet.map((value) => `- ${value}`).join('\n')}`);
  }

  if (findings.length > 0) {
    sections.push(`Key findings:\n${findings.map((value) => `- ${value}`).join('\n')}`);
  }

  if (unknowns.length > 0) {
    sections.push(`Open unknowns:\n${unknowns.map((value) => `- ${value}`).join('\n')}`);
  }

  const text = truncateText(sections.join('\n\n'), maxChars);
  return {
    text,
    stats: {
      repoRoots: repoSummary.projectRoots.length,
      importantFiles: repoSummary.importantFiles.length,
      workingSet: workingSet.length,
      findings: findings.length,
      unknowns: unknowns.length,
      chars: text.length,
    },
  };
}
