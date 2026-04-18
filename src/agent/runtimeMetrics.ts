import type { RepositorySummary } from './repoScan';
import type { AgentRuntimeContext } from './types';
import { debugLog } from '../utils/debug';

export interface RuntimeMetricsSnapshot {
  startedAt: number;
  taskMode?: string;
  historyStrategy?: string;
  filesDiscovered: number;
  filesRead: number;
  toolFailures: number;
  retries: number;
  promptTokens: number[];
  compiledContextChars: number;
  approvalsTriggered: number;
  compactedContextSize: number;
  repoScanCacheHit?: boolean | null;
  firstUsefulAnswerMs?: number;
  totalTaskDurationMs?: number;
}

const GLOBAL_KEY = '__mosaic_runtime_metrics__';
const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: RuntimeMetricsSnapshot | null;
};

function getState(): RuntimeMetricsSnapshot | null {
  return globalState[GLOBAL_KEY] ?? null;
}

export function startRuntimeMetrics(runtimeContext?: AgentRuntimeContext): void {
  globalState[GLOBAL_KEY] = {
    startedAt: Date.now(),
    taskMode: runtimeContext?.taskModeDecision?.mode,
    historyStrategy: runtimeContext?.contextMetrics?.historyStrategy,
    filesDiscovered: 0,
    filesRead: 0,
    toolFailures: 0,
    retries: 0,
    promptTokens: [],
    compiledContextChars: runtimeContext?.contextMetrics?.compiledContextChars ?? 0,
    approvalsTriggered: 0,
    compactedContextSize: runtimeContext?.contextMetrics?.compactedContextSize ?? 0,
    repoScanCacheHit: runtimeContext?.repoSummary?.cacheHit ?? null,
  };
  if (runtimeContext?.repoSummary) {
    globalState[GLOBAL_KEY]!.filesDiscovered = runtimeContext.repoSummary.importantFiles.length;
  }
}

export function recordRepoScanMetrics(summary: RepositorySummary): void {
  const state = getState();
  if (!state) return;
  state.filesDiscovered = summary.importantFiles.length;
  state.repoScanCacheHit = summary.cacheHit;
}

export function recordContextCompilation(chars: number, compactedSize: number): void {
  const state = getState();
  if (!state) return;
  state.compiledContextChars = chars;
  state.compactedContextSize = compactedSize;
}

export function recordToolMetrics(toolName: string, success: boolean, extra?: { filesRead?: number; filesDiscovered?: number; retry?: boolean }): void {
  const state = getState();
  if (!state) return;
  if (toolName === 'read') {
    state.filesRead += extra?.filesRead ?? 1;
  }
  if (extra?.filesDiscovered) {
    state.filesDiscovered += extra.filesDiscovered;
  }
  if (!success) {
    state.toolFailures += 1;
  }
  if (extra?.retry) {
    state.retries += 1;
  }
}

export function recordApprovalTriggered(): void {
  const state = getState();
  if (!state) return;
  state.approvalsTriggered += 1;
}

export function recordPromptTokens(promptTokens: number): void {
  const state = getState();
  if (!state) return;
  state.promptTokens.push(promptTokens);
}

export function markFirstUsefulAnswer(): void {
  const state = getState();
  if (!state || state.firstUsefulAnswerMs !== undefined) return;
  state.firstUsefulAnswerMs = Date.now() - state.startedAt;
}

export function finishRuntimeMetrics(): RuntimeMetricsSnapshot | null {
  const state = getState();
  if (!state) return null;
  state.totalTaskDurationMs = Date.now() - state.startedAt;
  debugLog(
    `[metrics] mode=${state.taskMode ?? 'unknown'} historyStrategy=${state.historyStrategy ?? 'unknown'} repoScanCacheHit=${state.repoScanCacheHit == null ? 'n/a' : state.repoScanCacheHit} firstUsefulMs=${state.firstUsefulAnswerMs ?? -1} filesDiscovered=${state.filesDiscovered} filesRead=${state.filesRead} toolFailures=${state.toolFailures} retries=${state.retries} promptTokens=${state.promptTokens.join(',') || 'none'} contextChars=${state.compiledContextChars} compactedContextSize=${state.compactedContextSize} approvals=${state.approvalsTriggered} totalDurationMs=${state.totalTaskDurationMs}`,
  );
  return { ...state };
}
