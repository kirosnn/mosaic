import { describe, expect, it } from 'bun:test';
import { buildChatItems, getCompactResult } from '../chatItemBuilder';
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

describe('buildChatItems — grouped read-only tools', () => {
  it('groups consecutive read-only tools behind the preceding assistant goal', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Je vais inspecter la configuration puis lire les fichiers utiles.',
      },
      {
        id: 'title-1',
        role: 'tool',
        toolName: 'title',
        toolArgs: { title: 'Config' },
        toolResult: { title: 'Config' },
        content: 'Title (Config)\nConfig',
      },
      {
        id: 'glob-1',
        role: 'tool',
        toolName: 'glob',
        toolArgs: { pattern: '**/*.json' },
        toolResult: JSON.stringify(['package.json', 'tsconfig.json']),
        content: 'Glob (**/*.json)\n  package.json\n  tsconfig.json',
        success: true,
      },
      {
        id: 'read-1',
        role: 'tool',
        toolName: 'read',
        toolArgs: { path: 'package.json' },
        toolResult: '{\n  "name": "mosaic"\n}',
        content: 'Read (package.json)\nRead 3 lines',
        success: true,
      },
    ];

    const items = buildChatItems({
      messages,
      maxWidth: 80,
      viewportHeight: 40,
      questionRequest: null,
      approvalRequest: null,
    });

    const toolGroup = items.find((item) => item.type === 'tool_group');
    expect(toolGroup).toBeDefined();
    expect(toolGroup?.toolGroupGoal).toBe('Inspecter la configuration puis lire les fichiers utiles.');
    expect(toolGroup?.toolGroupEntries).toHaveLength(2);
    expect(toolGroup?.toolGroupEntries?.[0]?.label).toContain('Glob');
    expect(toolGroup?.toolGroupEntries?.[1]?.label).toContain('Read');
  });

  it('does not include non read-only bash commands in the grouped tool block', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Je vais vérifier puis modifier le dépôt.',
      },
      {
        id: 'bash-1',
        role: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'git status --short --branch' },
        toolResult: '## main',
        content: 'Command (git status --short --branch)\n## main',
        success: true,
      },
      {
        id: 'bash-2',
        role: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'git add README.md' },
        toolResult: '',
        content: 'Command (git add README.md)',
        success: true,
      },
    ];

    const items = buildChatItems({
      messages,
      maxWidth: 80,
      viewportHeight: 40,
      questionRequest: null,
      approvalRequest: null,
    });

    const toolGroup = items.find((item) => item.type === 'tool_group');
    expect(toolGroup).toBeDefined();
    expect(toolGroup?.toolGroupEntries).toHaveLength(1);
    expect(toolGroup?.toolGroupEntries?.[0]?.label).toContain('git status');
  });

  it('uses the previous title tool when no assistant message exists', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Je veux un état rapide du dépôt. Vérifie git status, git branch --show-current et liste les fichiers du dossier src, puis résume.',
      },
      {
        id: 'title-1',
        role: 'tool',
        toolName: 'title',
        toolArgs: { title: 'État rapide du dépôt' },
        toolResult: { title: 'État rapide du dépôt' },
        content: 'Title (État rapide du dépôt)\nÉtat rapide du dépôt',
      },
      {
        id: 'bash-1',
        role: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'git branch --show-current' },
        toolResult: 'main',
        content: 'Command (git branch --show-current)\nmain',
        success: true,
      },
      {
        id: 'bash-2',
        role: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'git status --short --branch' },
        toolResult: '## main',
        content: 'Command (git status --short --branch)\n## main',
        success: true,
      },
    ];

    const items = buildChatItems({
      messages,
      maxWidth: 80,
      viewportHeight: 40,
      questionRequest: null,
      approvalRequest: null,
    });

    const toolGroup = items.find((item) => item.type === 'tool_group');
    expect(toolGroup).toBeDefined();
    expect(toolGroup?.toolGroupGoal).toBe('État rapide du dépôt');
    expect(toolGroup?.toolGroupEntries).toHaveLength(2);
  });

  it('falls back to an agent-side generated title when no assistant or title exists', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Je veux un état rapide du dépôt.',
      },
      {
        id: 'bash-1',
        role: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'git status --short --branch' },
        toolResult: '## main',
        content: 'Command (git status --short --branch)\n## main',
        success: true,
      },
    ];

    const items = buildChatItems({
      messages,
      maxWidth: 80,
      viewportHeight: 40,
      questionRequest: null,
      approvalRequest: null,
    });

    const toolGroup = items.find((item) => item.type === 'tool_group');
    expect(toolGroup).toBeDefined();
    expect(toolGroup?.toolGroupGoal).toBe('Inspecting repository');
  });
});
