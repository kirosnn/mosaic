type ExploreToolCallback = (toolName: string, args: Record<string, unknown>, result: { success: boolean; preview: string }) => void;

let currentAbortController: AbortController | null = null;
let toolCallback: ExploreToolCallback | null = null;

export function setExploreAbortController(controller: AbortController | null): void {
  currentAbortController = controller;
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

export function notifyExploreTool(toolName: string, args: Record<string, unknown>, result: { success: boolean; preview: string }): void {
  toolCallback?.(toolName, args, result);
}
