import { describe, expect, it } from 'bun:test';
import { getCompactResult } from '../chatItemBuilder';
import type { Message } from '../types';

function makeToolMessage(toolName: string, toolResult: unknown, content = ''): Message {
  return {
    id: 'test',
    role: 'tool',
    content,
    toolName,
    toolResult,
  };
}

describe('getCompactResult — list tool', () => {
  it('returns N results for a simple file array', () => {
    const result = JSON.stringify([
      { name: 'src', type: 'directory' },
      { name: 'package.json', type: 'file' },
      { name: 'README.md', type: 'file' },
    ]);
    const msg = makeToolMessage('list', result);
    expect(getCompactResult(msg)).toBe('3 results');
  });

  it('returns "1 result" (singular) for a single-entry array', () => {
    const result = JSON.stringify([{ name: 'index.ts', type: 'file' }]);
    const msg = makeToolMessage('list', result);
    expect(getCompactResult(msg)).toBe('1 result');
  });

  it('returns N results for a recursive {files:[]} object', () => {
    const result = JSON.stringify({
      files: [
        { path: 'src/index.ts', type: 'file' },
        { path: 'src/utils.ts', type: 'file' },
      ],
    });
    const msg = makeToolMessage('list', result);
    expect(getCompactResult(msg)).toBe('2 results');
  });

  it('returns "1 result" (singular) for a single-file recursive object', () => {
    const result = JSON.stringify({ files: [{ path: 'README.md', type: 'file' }] });
    const msg = makeToolMessage('list', result);
    expect(getCompactResult(msg)).toBe('1 result');
  });

  it('returns truncated label for truncated summary instead of (empty)', () => {
    const result = JSON.stringify({
      truncated: true,
      totalEntries: 350,
      note: 'Truncated at 300 entries.',
      topLevelBreakdown: { src: { files: 200, dirs: 10 }, docs: { files: 40, dirs: 2 } },
    });
    const msg = makeToolMessage('list', result);
    const compact = getCompactResult(msg);
    expect(compact).not.toBe('(empty)');
    expect(compact).toContain('350');
    expect(compact).toContain('truncated');
  });

  it('does not show (empty) when tool result is a non-empty array', () => {
    const result = JSON.stringify([{ name: 'index.ts', type: 'file' }]);
    const msg = makeToolMessage('list', result, 'List (.)\n(empty)');
    const compact = getCompactResult(msg);
    expect(compact).not.toBe('(empty)');
    expect(compact).toBe('1 result');
  });
});

describe('getCompactResult — lightweight greetings stay lightweight', () => {
  it('returns in progress for running tools', () => {
    const msg: Message = {
      id: 'test',
      role: 'tool',
      content: '',
      toolName: 'list',
      isRunning: true,
    };
    expect(getCompactResult(msg)).toBe('in progress...');
  });
});
