import type { SmartContextMessage } from './context';
import { isEnvironmentConfigIntent } from './environmentContext';
import { isSubsystemQuestion } from '../utils/subsystemDiscovery';
import { debugLog } from '../utils/debug';

export type TaskMode = 'chat' | 'assistant_capabilities' | 'environment_config' | 'explore_readonly' | 'plan' | 'edit' | 'run' | 'review';

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
  /\bgit\b/i,
  /\brepo(?:sitory)?\b/i,
  /\bfichiers?\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?(?:diff|changes|commits?|log|branch|status)\b/i,
  /\bwhat(?:'s|\s+is)\s+(?:changed|modified|staged|the\s+diff|the\s+status)\b/i,
  /\bcommit\s+history\b/i,
  /\bcurrent\s+branch\b/i,
];

const SUBSYSTEM_PATTERNS = [
  /\bsubsystem\b/i,
  /\bshell\b/i,
  /\bterminal\b/i,
  /\bcurrent\s+shell\b/i,
  /\bactive\s+shell\b/i,
  /\bpwsh\b/i,
  /\bpowershell\b/i,
  /\bcmd\.exe\b/i,
  /\bwsl\b/i,
  /\bgit\s+bash\b/i,
  /\bbash\s+environment\b/i,
  /\bexecution\s+environment\b/i,
  /\bwhat\s+shell\b/i,
  /\bpreferred\s+subsystem\b/i,
  /\beffective\s+subsystem\b/i,
  /\binstalled\s+subsystems?\b/i,
  /\bavailable\s+subsystems?\b/i,
  /\bfallback\s+order\b/i,
];

const LIGHTWEIGHT_CHAT_PATTERNS = [
  /^(?:salut|bonjour|hello|hi|hey)\b[!.!? ]*$/i,
  /^(?:merci|thanks|thank you|super|parfait|top|nickel)\b[!.!? ]*$/i,
  /^(?:ok|okay|ok merci|ça marche|ca marche|c'est bon|noted|understood|got it|sounds good)\b[!.!? ]*$/i,
  /^(?:d'accord|dac|bien reçu|reçu)\b[!.!? ]*$/i,
];

const ASSISTANT_CAPABILITY_PATTERNS = [
  /^(?:tu|t['’]as|t as|tes|toi|mosaic|assistant)\b.*\b(?:skills?|outils?|capacités?|capability|capabilities|limits?|limites?)\b.*\??$/i,
  /^(?:tu|t['’]as|t as|mosaic|assistant)\b.*\b(?:peux|can)\b.*\b(?:faire|do)\b.*\??$/i,
  /^(?:quels?|quelles?)\b.*\b(?:outils?|tools?|skills?|capacités?|capabilities|limites?)\b.*\b(?:tu|t['’]as|t as|mosaic|assistant)\b.*\??$/i,
  /^(?:t['’]as|tu as|as-tu|what|which|how)\b.*\b(?:accès|access|tools?|skills?|capabilities|limits?)\b.*\??$/i,
  /^(?:comment)\b.*\b(?:tu|mosaic|assistant)\b.*\b(?:fonctionnes?|marches?|works?)\b.*\??$/i,
  /^(?:what can you do|what tools do you have|what skills do you have|how do you work|what are your limits)\??$/i,
  /^(?:tu|t['’]as|t as|as-tu|do you have|can you use|can you call|what)\b.*\b(?:mcp|serveurs?\s+mcp|mcp\s+servers?|permissions?|modes?|edit files?|modifier des fichiers|call mcp|utiliser mcp)\b.*\??$/i,
];

const WORKSPACE_REFERENCE_PATTERNS = [
  /\brepo(?:sitory)?\b/i,
  /\bworkspace\b/i,
  /\bproject\b/i,
  /\bcodebase\b/i,
  /\bfichiers?\b/i,
  /\bfiles?\b/i,
  /\bfolder\b/i,
  /\bdirectory\b/i,
  /\bdossier\b/i,
  /\brépertoire\b/i,
  /\bbranch\b/i,
  /\bdiff\b/i,
  /\bcommit\b/i,
  /\bpackage\.json\b/i,
  /\bsrc\b/i,
  /\btests?\b/i,
];

const WORKSPACE_INSPECTION_PATTERNS = [
  /^(?:what(?:’s|\s+is)\s+)?in\s+(?:this|the|current|my|your|the\s+current|the\s+present|the\s+working)\s+(?:folder|directory|repo|repository|project|workspace|codebase)\b.*\??$/i,
  /\blist\s+(?:the\s+)?files?\b.*\??$/i,
  /^(?:inspect)\s+(?:this|the|current|my|the\s+current|the\s+present|the\s+working)\s+(?:repo|repository|project|workspace|codebase)\b.*\??$/i,
  /\bce\s+qui\s+se\s+trouve\s+dans\s+(?:ce|le|le\s+présent|mon|votre|le\s+présent)\s+(?:dossier|répertoire|projet|repo|repository)\b.*\??$/i,
  /\blister\s+(?:les\s+)?fichiers?\b.*\??$/i,
  /\bwhat(?:’s|\s+is)\s+in\s+this\b.*\??$/i,
  /\bqu’est-ce\s+qu’il\s+y\s+a\s+dans\s+this\b.*\??$/i,
  /\bqu[‘’]y\s+a-t-il\s+dans\s+ce\s+dossier\b.*\??$/i,
  /\bliste\s+les\s+fichiers\s+ici\b.*\??$/i,
  /\bwhat\s+is\s+in\s+this\s+folder\b.*\??$/i,
  /\bwhat\s+is\s+in\s+the\s+current\s+directory\b.*\??$/i,
  /\binspect\s+this\s+project\b.*\??$/i,
  /\blist\s+files\s+here\b.*\??$/i,
  // CWD / current folder queries
  /\bdans\s+quel\s+(?:dossier|répertoire|repo|projet)\b/i,
  /\bon\s+est\s+(?:dans|où)\b/i,
  /\bquel(?:\s+est)?\s+(?:le\s+)?(?:dossier|répertoire|chemin|path)\s+(?:courant|actuel|de\s+travail)\b/i,
  /\bcurrent\s+(?:working\s+)?(?:directory|folder|path)\b/i,
  /\b(?:what(?:’s|\s+is)\s+(?:the\s+)?)?cwd\b/i,
  /\bpwd\b/i,
  /\bwhere\s+(?:are\s+we|am\s+i)\b/i,
  /\brépertoire\s+courant\b/i,
];

const ASSISTANT_REFERENCE_PATTERNS = [
  /\btu\b/i,
  /\btoi\b/i,
  /\bt['’]as\b/i,
  /\btes\b/i,
  /\bas-tu\b/i,
  /\byou\b/i,
  /\byour\b/i,
  /\bassistant\b/i,
  /\bmosaic\b/i,
];

const ASSISTANT_CAPABILITY_KEYWORDS = [
  /\bskills?\b/i,
  /\boutils?\b/i,
  /\btools?\b/i,
  /\bcapacités?\b/i,
  /\bcapabilit(?:y|ies)\b/i,
  /\blimites?\b/i,
  /\blimits?\b/i,
  /\baccès\b/i,
  /\baccess\b/i,
  /\bfonctionnes?\b/i,
  /\bworks?\b/i,
  /\bfaire\b/i,
  /\bdo\b/i,
  /\bmcp\b/i,
  /\bpermissions?\b/i,
  /\bmodes?\b/i,
  /\bedit files?\b/i,
  /\bmodifier des fichiers\b/i,
];

const CONTINUATION_PATTERNS = [
  /^(?:ok|okay|ça marche|ca marche|c'est bon|got it|understood|noted|bien reçu|reçu)\b[!.!? ]*$/i,
  /^(?:continue|vas-y|go ahead|proceed|tu peux continuer|you can continue)\b[!.!? ]*$/i,
  /^(?:fais-le|do it|lance-toi|carry on)\b[!.!? ]*$/i,
  /^(?:et maintenant|et du coup|ok et du coup|what now|now what|and now)\b[!.!? ]*$/i,
];

const COMPLEX_ENVIRONMENT_PATTERNS = [
  /\bwhy\b/i,
  /\bpourquoi\b/i,
  /\bdiagnos(?:e|is|tic)\b/i,
  /\bdebug\b/i,
  /\btroubleshoot\b/i,
  /\bcompare\b/i,
  /\bvs\b/i,
  /\bversus\b/i,
  /\brecommend(?:ation)?\b/i,
  /\brecommande?r\b/i,
  /\bshould i\b/i,
  /\bwhich is better\b/i,
  /\bexplain\b/i,
  /\bexplique?r\b/i,
  /\bfallback\b/i,
  /\bsession\b/i,
  /\bsessions\b/i,
  /\brepo(?:sitory)?\b/i,
  /\bproject\b/i,
  /\bworkspace\b/i,
  /\btooling\b/i,
  /\bfail(?:s|ed|ing)?\b/i,
  /\berror\b/i,
  /\bbroken\b/i,
  /\bissue\b/i,
  /\bproblem\b/i,
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

function normalizeCompact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getTokenCount(text: string): number {
  return normalizeCompact(text).split(' ').filter(Boolean).length;
}

export function isLightweightTaskMode(mode: TaskMode | null | undefined): boolean {
  return mode === 'chat' || mode === 'assistant_capabilities';
}

export function shouldUseRepositoryContext(mode: TaskMode | null | undefined): boolean {
  return mode !== 'chat' && mode !== 'assistant_capabilities' && mode !== 'environment_config';
}

export function shouldBypassModelTaskRouter(
  decision: Omit<TaskModeDecision, 'latestUserRequest'> | null | undefined,
): boolean {
  if (!decision) {
    return false;
  }

  if (decision.confidence !== 'high') {
    return false;
  }

  return decision.mode === 'chat'
    || decision.mode === 'assistant_capabilities'
    || decision.mode === 'environment_config'
    || decision.mode === 'explore_readonly';
}

export function isLightweightChatIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const compact = normalizeCompact(normalized);
  const tokenCount = getTokenCount(compact);
  if (tokenCount > 6 || compact.length > 48) {
    return false;
  }

  return matchesAny(compact, LIGHTWEIGHT_CHAT_PATTERNS);
}

function isAssistantCapabilityIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const compact = normalizeCompact(normalized);
  const tokenCount = getTokenCount(compact);
  if (tokenCount > 20 || compact.length > 160) {
    return false;
  }
  if (matchesAny(compact, WORKSPACE_REFERENCE_PATTERNS)) {
    return false;
  }
  if (matchesAny(compact, ASSISTANT_CAPABILITY_PATTERNS)) {
    return true;
  }
  if (!compact.includes('?') && !/\b(?:comment|how|quels?|quelles?|what|which|tu peux|can you|as-tu|t['’]as)\b/i.test(compact)) {
    return false;
  }
  return matchesAny(compact, ASSISTANT_CAPABILITY_KEYWORDS)
    && matchesAny(compact, ASSISTANT_REFERENCE_PATTERNS);
}

function isContinuationIntent(text: string): boolean {
  const compact = normalizeCompact(text);
  if (!compact || getTokenCount(compact) > 8 || compact.length > 64) {
    return false;
  }
  return matchesAny(compact, CONTINUATION_PATTERNS);
}

export function shouldUseLightweightEnvironmentHandling(
  messages: SmartContextMessage[],
  decision?: Pick<TaskModeDecision, 'mode' | 'latestUserRequest'> | null,
): boolean {
  const latestUserRequest = normalizeCompact(
    decision?.latestUserRequest ?? getLatestUserRequest(messages),
  );
  if (!latestUserRequest) {
    return false;
  }

  const mode = decision?.mode ?? detectTaskMode(messages).mode;
  if (mode !== 'environment_config') {
    return false;
  }

  const tokenCount = getTokenCount(latestUserRequest);
  const recentTechnicalMode = inferRecentTechnicalMode(messages);
  const isSimpleContinuation = isContinuationIntent(latestUserRequest)
    && recentTechnicalMode?.mode === 'environment_config'
    && tokenCount <= 8;

  if (isSimpleContinuation) {
    return true;
  }

  if (!isSubsystemQuestion(latestUserRequest)) {
    return false;
  }

  if (tokenCount > 14 || latestUserRequest.length > 120) {
    return false;
  }

  if (matchesAny(latestUserRequest, COMPLEX_ENVIRONMENT_PATTERNS)) {
    return false;
  }

  return true;
}

function classifyTextTaskMode(text: string): Omit<TaskModeDecision, 'latestUserRequest'> | null {
  const normalized = normalizeCompact(text);
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return null;
  }

  if (matchesAny(lower, SUBSYSTEM_PATTERNS)) {
    return { mode: 'environment_config', confidence: 'high', reason: 'subsystem or shell environment question detected' };
  }

  if (matchesAny(lower, WORKSPACE_INSPECTION_PATTERNS)) {
    return { mode: 'explore_readonly', confidence: 'high', reason: 'workspace inspection request detected' };
  }

  if (isLightweightChatIntent(normalized)) {
    return { mode: 'chat', confidence: 'high', reason: 'trivial small-talk detected' };
  }

  if (isAssistantCapabilityIntent(normalized)) {
    return { mode: 'assistant_capabilities', confidence: 'high', reason: 'assistant capability question detected' };
  }

  if (isEnvironmentConfigIntent(normalized)) {
    return { mode: 'environment_config', confidence: 'high', reason: 'local machine or app configuration request detected' };
  }

  if (matchesAny(lower, REVIEW_PATTERNS)) {
    return { mode: 'review', confidence: 'high', reason: 'review language detected' };
  }

  if (matchesAny(lower, PLAN_PATTERNS) && !matchesAny(lower, EDIT_PATTERNS)) {
    return { mode: 'plan', confidence: 'high', reason: 'planning-only language detected' };
  }

  if (matchesAny(lower, EXPLORE_PATTERNS) && !matchesAny(lower, EDIT_PATTERNS) && !matchesAny(lower, RUN_PATTERNS)) {
    return { mode: 'explore_readonly', confidence: 'high', reason: 'architecture or understanding request detected' };
  }

  if (matchesAny(lower, RUN_PATTERNS) && !matchesAny(lower, EDIT_PATTERNS)) {
    return { mode: 'run', confidence: 'medium', reason: 'execution or verification language detected' };
  }

  if (matchesAny(lower, EDIT_PATTERNS)) {
    return { mode: 'edit', confidence: 'medium', reason: 'implementation language detected' };
  }

  if (normalized.includes('?')) {
    return {
      mode: getTokenCount(normalized) <= 10 ? 'explore_readonly' : 'plan',
      confidence: 'low',
      reason: 'question-shaped request fallback',
    };
  }

  return null;
}

function inferRecentTechnicalMode(messages: SmartContextMessage[]): Omit<TaskModeDecision, 'latestUserRequest'> | null {
  for (let i = messages.length - 2; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'user') {
      continue;
    }
    const classified = classifyTextTaskMode(message.content);
    if (!classified || classified.mode === 'chat') {
      continue;
    }
    return {
      mode: classified.mode,
      confidence: classified.confidence === 'low' ? 'medium' : classified.confidence,
      reason: `continuation of recent ${classified.mode} request`,
    };
  }
  return null;
}

export function detectTaskMode(messages: SmartContextMessage[]): TaskModeDecision {
  const latestUserRequest = getLatestUserRequest(messages);
  const direct = classifyTextTaskMode(latestUserRequest);
  const recentTechnicalMode = inferRecentTechnicalMode(messages);

  if (isContinuationIntent(latestUserRequest)) {
    if (recentTechnicalMode) {
      return {
        ...recentTechnicalMode,
        latestUserRequest,
      };
    }
  }

  if (direct) {
    return {
      ...direct,
      latestUserRequest,
    };
  }

  if (recentTechnicalMode && getTokenCount(latestUserRequest) <= 6) {
    return {
      ...recentTechnicalMode,
      latestUserRequest,
    };
  }

  return { mode: 'edit', confidence: 'low', reason: 'default edit mode fallback', latestUserRequest };
}

export function getTaskModeLabel(mode: TaskMode): string {
  switch (mode) {
    case 'chat':
      return 'Chat';
    case 'assistant_capabilities':
      return 'Assistant Capabilities';
    case 'environment_config':
      return 'Environment / Local Config';
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
    case 'chat':
      return `${header}
- Treat the request as lightweight conversation.
- Do not rely on repository scans, repo summaries, or repo-aware routing.
- Do not call tools unless the user clearly asks for an action or external information.`;
    case 'assistant_capabilities':
      return `${header}
- Answer questions about Mosaic's own modes, tools, skills, permissions, and limitations.
- Do not rely on repository scans, repo summaries, workspace context, or file-specific context.
- Ground the answer in the provided local capability summary and avoid generic claims.`;
    case 'environment_config':
      return `${header}
- Treat the request as local machine, app, editor, folder, or MCP configuration work rather than repository exploration.
- Do NOT trigger repository-oriented discovery or assume the launch directory is the main scope unless the user explicitly makes it relevant.
- Prefer exact paths, known config roots, exact filenames, and app-specific expected locations before any broader search.
- Ask early for missing critical values such as the exact folder path, app/profile name, or whether to create versus update a config.
- Use bounded discovery: known paths first, high-confidence candidates second, small targeted searches third, broad fallback only as a last resort.
- Do not recursively list a home directory, desktop root, or other broad local scope.
- Keep outside-workspace reads and writes policy-aware; approvals and review still apply when required.`;
    case 'explore_readonly':
      return `${header}
- Start from the deterministic repo scan summary when available. It already contains manifests, entrypoints, and key config files.
- Do NOT call list with recursive=true on the root directory or broad paths. It will be truncated and wastes tokens.
- Use glob or grep with specific patterns to locate files when the repo scan is not sufficient.
- Read only targeted files: primary manifest, primary entrypoint, a few core modules. Stop once the architecture is clear.
- Do not explore tests/, tools/, or artifacts/ unless explicitly asked.
- Do not call write, edit, bash, or mutation MCP tools unless the user explicitly asks for changes or execution.
- Do not call plan for read-only understanding tasks.

───────────────────────────────────────────────
WORKSPACE / FOLDER INSPECTION FLOW
Applies to: "what's in this folder", "list files", "inspect this project", or equivalent.
───────────────────────────────────────────────

Step 1 — NARRATIVE FIRST (text before any tool call):
  Output a short visible message in the user's language. This must appear BEFORE title and all tools.
  Vary the phrasing. Examples:
  - "Je vais inspecter la structure du projet puis vérifier les manifestes importants."
  - "Je commence par regarder la racine, puis je vais confirmer les technologies présentes."
  - "Let me inspect the workspace structure."

Step 2 — TITLE (first tool call):
  Call title in the user's language. Examples:
  - "Inspection du dossier courant" / "Structure du projet" / "Workspace overview"

Step 3 — LIST TOP LEVEL:
  Call list(path=".", recursive=false). Can be parallel with title.

Step 4 — INTER-PHASE NARRATION + PARALLEL GLOB FOR PROJECT MARKERS:
  After the listing result arrives, write one sentence about what you see and what you are checking next:
  - "La racine contient un .sln et plusieurs répertoires — je vais vérifier les manifestes .NET et Node."
  - "I can see .csproj files and a package.json — checking those in parallel."
  Then call globs in parallel for plausible project markers only:
  - glob("**/package.json")         JS/TS/Node tooling visible
  - glob("**/*.csproj")             .NET project files
  - glob("**/*.sln")                Visual Studio solution
  - glob("**/Cargo.toml")           Rust workspace or crate
  - glob("**/go.mod")               Go module
  - glob("**/pyproject.toml")       Python project
  Do NOT glob blindly for everything. Pick only markers that are plausible from the listing.

Step 5 — FOCUSED READS (optional):
  Read key manifest snippets (name, description, workspace members) only when they add concrete interpretation value.
  Skip if listing + globs already give enough signal.

Step 6 — TRANSITION + SYNTHESIS:
  Emit a short transition phrase naturally suited to the context, then deliver a structured final answer.
  Vary transitions — do NOT always use the same phrase.

  The final answer MUST include:
  - What the project concretely appears to be (product type, target platform, likely use case)
  - Primary technology stack (language, framework, runtime — be specific)
  - Important source roots grouped by role: source code, tests, scripts, docs, config
  - Key manifests and what each one indicates
  - Build/generated/output directories flagged as secondary: artifacts/, dist/, target/, __pycache__/, node_modules/
  - Mixed-language or multi-technology setup explained (e.g., "Rust component for X, Node tooling for Y")
  - Likely developer workflow when obvious from the structure

  The final answer must EXPLAIN, not just LIST.
  "Found package.json, Cargo.toml, and *.csproj" is NOT acceptable.
  "This appears to be a Windows desktop app in .NET/C# with Bun/Node tooling at the root and a Rust component for speech integration" IS the target quality.

CRITICAL: Always synthesize. Use the repo scan summary when available.

───────────────────────────────────────────────
GIT REPORTING FLOW
Applies to: "git status", "état git", "full git report", "what changed", "donne-moi un rapport git", etc.
───────────────────────────────────────────────

Step 1 — NARRATIVE FIRST (text before any tool call):
  One sentence in the user's language explaining what you are about to check.
  This MUST appear as text output BEFORE the title tool call.
  Examples:
  - "Je vais examiner l'état Git actuel, les derniers commits et la configuration du dépôt."
  - "Let me pull together a full Git status report."
  - "Je vais vérifier la branche, les modifications locales et les commits récents."

Step 2 — TITLE (first tool call):
  Call title in the user's language. Examples:
  - "Rapport Git" / "État du dépôt" / "Git status report"

Step 3 — GIT INVESTIGATION (read-only bash commands):
  Run a compact, targeted git batch. Prefer these commands:
  - git status --short --branch         (state + branch + divergence)
  - git log --oneline -n 5              (recent commit direction)
  - git remote -v                       (remote setup)
  - git diff --stat                     (if modifications are present)
  - git stash list                      (if relevant)
  Run commands in parallel where possible. Do NOT run redundant commands if a structured wrapper already provides the same data.

Step 4 — SYNTHESIS: produce a real repository report covering:
  - Overall state: clean vs dirty (explain, don't just count)
  - Current branch and divergence from remote (ahead/behind)
  - Modified files: what was changed and what it likely means
  - Untracked files: brief mention
  - Recent commit trend: what direction is work heading
  - Remote setup: where pushes go
  - Concrete next action when relevant: "tu peux pousser", "il reste X fichiers à nettoyer", etc.

  The report must read like a human wrote it, not like command output was pasted.
  Use structured tool output fields (modifiedCount, untrackedCount, aheadCount, behindCount, currentBranch) when a wrapper provides them — do not ignore them.`;

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
