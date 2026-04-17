import type { SmartContextMessage } from './context';

export type TaskMode = 'explore_readonly' | 'plan' | 'edit' | 'run' | 'review';

export interface TaskModeDecision {
  mode: TaskMode;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  latestUserRequest: string;
}

const REVIEW_PATTERNS = [
  /\breview\b/i,
  /\baudit\b/i,
  /\binspect changes\b/i,
  /\bcode review\b/i,
];

const PLAN_PATTERNS = [
  /\bplan\b/i,
  /\broadmap\b/i,
  /\bapproach\b/i,
  /\bstrategy\b/i,
  /\bdesign\b/i,
  /\bpropose\b/i,
  /\bbrainstorm\b/i,
];

const RUN_PATTERNS = [
  /\brun\b/i,
  /\bexecute\b/i,
  /\btest\b/i,
  /\bbuild\b/i,
  /\bbenchmark\b/i,
  /\bverify\b/i,
  /\bcheck\b/i,
];

const EDIT_PATTERNS = [
  /\bfix\b/i,
  /\bimplement\b/i,
  /\brefactor\b/i,
  /\bchange\b/i,
  /\bupdate\b/i,
  /\bedit\b/i,
  /\bcreate\b/i,
  /\badd\b/i,
  /\bremove\b/i,
];

const EXPLORE_PATTERNS = [
  /\bunderstand\b/i,
  /\barchitecture\b/i,
  /\bexplain\b/i,
  /\bsummarize\b/i,
  /\bhow does\b/i,
  /\bhow do(?:es)?\b/i,
  /\bwhere is\b/i,
  /\bfind\b/i,
  /\btrace\b/i,
  /\bread\b/i,
  /\banalyze\b/i,
  /\bgit\s+(?:status|diff|log|show|branch|blame|stash\s+list|remote|tag|describe)\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?(?:diff|changes|commits?|log|branch|status)\b/i,
  /\bwhat(?:'s|\s+is)\s+(?:changed|modified|staged|the\s+diff|the\s+status)\b/i,
  /\bcommit\s+history\b/i,
  /\bcurrent\s+branch\b/i,
];

function getLatestUserRequest(messages: SmartContextMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function detectTaskMode(messages: SmartContextMessage[]): TaskModeDecision {
  const latestUserRequest = getLatestUserRequest(messages);
  const text = latestUserRequest.toLowerCase();

  if (matchesAny(text, REVIEW_PATTERNS)) {
    return { mode: 'review', confidence: 'high', reason: 'review language detected', latestUserRequest };
  }

  if (matchesAny(text, PLAN_PATTERNS) && !matchesAny(text, EDIT_PATTERNS)) {
    return { mode: 'plan', confidence: 'high', reason: 'planning-only language detected', latestUserRequest };
  }

  if (matchesAny(text, EXPLORE_PATTERNS) && !matchesAny(text, EDIT_PATTERNS) && !matchesAny(text, RUN_PATTERNS)) {
    return { mode: 'explore_readonly', confidence: 'high', reason: 'architecture or understanding request detected', latestUserRequest };
  }

  if (matchesAny(text, RUN_PATTERNS) && !matchesAny(text, EDIT_PATTERNS)) {
    return { mode: 'run', confidence: 'medium', reason: 'execution or verification language detected', latestUserRequest };
  }

  if (matchesAny(text, EDIT_PATTERNS)) {
    return { mode: 'edit', confidence: 'medium', reason: 'implementation language detected', latestUserRequest };
  }

  return { mode: 'edit', confidence: 'low', reason: 'default edit mode fallback', latestUserRequest };
}

export function getTaskModeLabel(mode: TaskMode): string {
  switch (mode) {
    case 'explore_readonly':
      return 'Explore / ReadOnly';
    case 'plan':
      return 'Plan';
    case 'edit':
      return 'Edit';
    case 'run':
      return 'Run';
    case 'review':
      return 'Review';
  }
}

export function buildTaskModePrompt(mode: TaskMode): string {
  const header = `Active task mode: ${getTaskModeLabel(mode)}`;

  switch (mode) {
    case 'explore_readonly':
      return `${header}
- Start from the deterministic repo scan summary. It already contains manifests, entrypoints, and key config files.
- Do NOT call list with recursive=true on the root directory or broad paths (apps/, src/, tests/). It will be truncated and wastes tokens.
- Use glob or grep with specific patterns to locate files when the repo scan is not sufficient.
- Read only targeted files: primary manifest, primary entrypoint, a few core modules. Stop once the architecture is clear.
- Do not explore tests/, tools/, or artifacts/ unless explicitly asked.
- Do not call write, edit, bash, or mutation MCP tools unless the user explicitly asks for changes or execution.
- Do not call plan for read-only understanding tasks.`;
    case 'plan':
      return `${header}
- Focus on producing and maintaining a compact plan.
- Avoid edits and shell execution unless the user explicitly asks to move from planning into implementation.`;
    case 'run':
      return `${header}
- Keep execution targeted and policy-aware.
- Prefer verification, diagnostics, and read-only shell work before broader changes.`;
    case 'review':
      return `${header}
- Prioritize findings, regressions, missing tests, and concrete evidence.
- Avoid edits unless the user explicitly asks for fixes after the review.`;
    case 'edit':
    default:
      return `${header}
- Use the repo scan summary to avoid redundant discovery.
- Keep plans compact and only when they materially help multi-step implementation.`;
  }
}
