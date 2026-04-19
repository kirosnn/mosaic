import { describe, expect, it } from 'bun:test';
import { applyToolResultToContinuationLedger, summarizeToolResultForContinuation } from '../continuationLedger';
import type { AgentMessage } from '../types';

describe('continuation ledger guards', () => {
  it('summarizes large discovery outputs without carrying raw payloads forward', () => {
    const result = JSON.stringify(Array.from({ length: 20 }, (_, index) => `dir/file-${index}.ts`));
    const summary = summarizeToolResultForContinuation('glob', { pattern: '**/*.ts', path: '.' }, result);

    expect(summary.guarded).toBe(true);
    expect(summary.summary).toContain('20 files');
    expect(summary.summary).toContain('file-0.ts');
  });

  it('stores continuation context in an assistant ledger instead of synthetic tool-result messages', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Continue the task.' },
    ];
    const ledgerEntries: string[] = [];
    const largeResult = JSON.stringify({
      total_matches: 240,
      files_with_matches: 18,
      truncated: true,
      results: Array.from({ length: 18 }, (_, index) => ({ file: `logs/file-${index}.log`, matches: [] })),
    });

    applyToolResultToContinuationLedger(history, ledgerEntries, 'grep', { query: 'token', path: 'logs' }, largeResult, true, 6);

    expect(history.some((entry) => entry.role === 'tool')).toBe(false);
    expect(history[history.length - 1]?.role).toBe('assistant');
    expect(String(history[history.length - 1]?.content)).toContain('TOOL LEDGER (continuation context):');
    expect(String(history[history.length - 1]?.content)).toContain('240 matches in 18 files');
  });
});
