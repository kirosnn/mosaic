import { debugLog } from '../../utils/debug';

const DEFAULT_MAX_ACCUMULATED_CHARS = 600_000;

export class ContextGuard {
  private accumulatedChars = 0;
  private maxChars: number;
  private triggered = false;

  constructor(maxContextTokens?: number) {
    this.maxChars = maxContextTokens
      ? Math.floor(maxContextTokens * 3 * 0.7)
      : DEFAULT_MAX_ACCUMULATED_CHARS;
  }

  trackToolResult(result: unknown): void {
    const size = typeof result === 'string'
      ? result.length
      : JSON.stringify(result).length;
    this.accumulatedChars += size;
  }

  shouldBreak(): boolean {
    if (this.triggered) return false;
    if (this.accumulatedChars >= this.maxChars) {
      this.triggered = true;
      debugLog(`[context-guard] breaking stream: accumulated ${this.accumulatedChars} chars >= limit ${this.maxChars}`);
      return true;
    }
    return false;
  }
}
