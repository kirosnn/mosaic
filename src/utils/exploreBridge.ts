import type { ConversationMemory } from '../agent/memory';
import { getGlobalMemory } from '../agent/memory';

type ExploreToolCallback = (toolName: string, args: Record<string, unknown>, result: { success: boolean; preview: string }, tokenEstimate: number) => void;

export interface ExploreToolEvent {
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  preview: string;
  tokenEstimate: number;
}

type ExploreToolSubscriber = (event: ExploreToolEvent) => void;

interface ExploreBridgeGlobal {
  currentAbortController: AbortController | null;
  toolCallback: ExploreToolCallback | null;
  totalExploreTokens: number;
  subscribers: Set<ExploreToolSubscriber>;
  parentContext: string;
  previousExploreSummaries: string[];
  conversationMemory: ConversationMemory | null;
}

const globalKey = '__mosaic_explore_bridge__';
const g = globalThis as any;

if (!g[globalKey]) {
  g[globalKey] = {
    currentAbortController: null,
    toolCallback: null,
    totalExploreTokens: 0,
    subscribers: new Set<ExploreToolSubscriber>(),
    parentContext: '',
    previousExploreSummaries: [],
    conversationMemory: null,
  };
}

const state: ExploreBridgeGlobal = g[globalKey];

export function setExploreAbortController(controller: AbortController | null): void {
  state.currentAbortController = controller;
  if (controller) {
    state.totalExploreTokens = 0;
  }
}

export function getExploreAbortSignal(): AbortSignal | undefined {
  return state.currentAbortController?.signal;
}

export function abortExplore(): void {
  state.currentAbortController?.abort();
}

export function isExploreAborted(): boolean {
  return state.currentAbortController?.signal.aborted ?? false;
}

export function setExploreToolCallback(callback: ExploreToolCallback | null): void {
  state.toolCallback = callback;
}

export function notifyExploreTool(toolName: string, args: Record<string, unknown>, result: { success: boolean; preview: string }, resultLength: number): void {
  const tokenEstimate = Math.ceil(resultLength / 4);
  state.totalExploreTokens += tokenEstimate;
  state.toolCallback?.(toolName, args, result, state.totalExploreTokens);

  const event: ExploreToolEvent = {
    toolName,
    args,
    success: result.success,
    preview: result.preview,
    tokenEstimate: state.totalExploreTokens,
  };
  console.log(`[EXPLORE BRIDGE] notify: ${toolName}, subs=${state.subscribers.size}`);
  state.subscribers.forEach(sub => {
    console.log(`[EXPLORE BRIDGE] calling subscriber`);
    sub(event);
  });
}

export function subscribeExploreTool(callback: ExploreToolSubscriber): () => void {
  state.subscribers.add(callback);
  console.log(`[EXPLORE BRIDGE] subscribe: now ${state.subscribers.size} subscribers`);
  return () => {
    state.subscribers.delete(callback);
    console.log(`[EXPLORE BRIDGE] unsubscribe: now ${state.subscribers.size} subscribers`);
  };
}

export function getExploreTokens(): number {
  return state.totalExploreTokens;
}

export function setExploreContext(context: string): void {
  state.parentContext = context;
}

export function getExploreContext(): string {
  return state.parentContext;
}

export function addExploreSummary(summary: string): void {
  state.previousExploreSummaries.push(summary);
}

export function getExploreSummaries(): string[] {
  return state.previousExploreSummaries;
}

export function resetExploreSummaries(): void {
  state.previousExploreSummaries = [];
}

export function setConversationMemory(memory: ConversationMemory | null): void {
  state.conversationMemory = memory;
}

export function getConversationMemory(): ConversationMemory {
  return state.conversationMemory ?? getGlobalMemory();
}
