type ExploreToolCallback = (toolName: string, args: Record<string, unknown>, result: { success: boolean; preview: string }, tokenEstimate: number) => void;

let currentAbortController: AbortController | null = null;
let toolCallback: ExploreToolCallback | null = null;
let totalExploreTokens = 0;

export function setExploreAbortController(controller: AbortController | null): void {
  currentAbortController = controller;
  if (controller) {
    totalExploreTokens = 0;
  }
}

export function getExploreAbortSignal(): AbortSignal | undefined {
  return currentAbortController?.signal;
}

export function abortExplore(): void {
  currentAbortController?.abort();
}

export function isExploreAborted(): boolean {
  return currentAbortController?.signal.aborted ?? false;
}

export function setExploreToolCallback(callback: ExploreToolCallback | null): void {
  toolCallback = callback;
}

export function notifyExploreTool(toolName: string, args: Record<string, unknown>, result: { success: boolean; preview: string }, resultLength: number): void {
  const tokenEstimate = Math.ceil(resultLength / 4);
  totalExploreTokens += tokenEstimate;
  toolCallback?.(toolName, args, result, totalExploreTokens);
}

export function getExploreTokens(): number {
  return totalExploreTokens;
}
