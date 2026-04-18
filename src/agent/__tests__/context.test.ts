import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildAssistantCapabilitiesConversationHistoryResult,
  buildLightweightChatConversationHistory,
  buildSmartConversationHistory,
} from '../context';
import { buildAgentRuntimeContext } from '../runtimeContext';

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalTaskRouterEnv = process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER;

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mosaic-context-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER = '1';
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalTaskRouterEnv === undefined) {
    delete process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER;
  } else {
    process.env.MOSAIC_DISABLE_MODEL_TASK_ROUTER = originalTaskRouterEnv;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildSmartConversationHistory', () => {
  it('bypasses repo-aware context for lightweight chat', async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'bun run build' } }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf-8');

    process.chdir(workspace);
    const messages = [{
      role: 'user' as const,
      content: 'Salut',
    }];
    const runtimeContext = await buildAgentRuntimeContext(messages);
    const history = buildSmartConversationHistory({
      messages,
      includeImages: false,
      taskModeDecision: runtimeContext.taskModeDecision,
      repoSummary: runtimeContext.repoSummary,
    });

    expect(runtimeContext.taskModeDecision?.mode).toBe('chat');
    expect(runtimeContext.repoSummary).toBeUndefined();
    expect(history).toEqual([
      {
        role: 'user',
        content: 'Salut',
      },
    ]);
  });

  it('keeps chat-mode history minimal and drops tool-heavy context', () => {
    const history = buildLightweightChatConversationHistory({
      messages: [
        { role: 'user', content: 'Fix the failing auth tests.' },
        { role: 'assistant', content: 'I am checking the auth module now.' },
        { role: 'tool', content: 'Read auth.ts', toolName: 'read', toolArgs: { path: 'src/auth.ts' }, toolResult: '...', success: true },
        { role: 'assistant', content: 'The failure comes from the token parser.' },
        { role: 'user', content: 'Merci' },
      ],
      includeImages: false,
    });

    expect(history).toEqual([
      { role: 'user', content: 'Fix the failing auth tests.' },
      { role: 'assistant', content: 'I am checking the auth module now.' },
      { role: 'assistant', content: 'The failure comes from the token parser.' },
      { role: 'user', content: 'Merci' },
    ]);
  });

  it('builds a local capability summary for assistant capability mode', async () => {
    const workspace = createWorkspace();
    process.chdir(workspace);

    const runtimeContext = await buildAgentRuntimeContext([
      { role: 'user', content: 'Tu as des skills ?' },
    ]);

    expect(runtimeContext.taskModeDecision?.mode).toBe('assistant_capabilities');
    expect(runtimeContext.repoSummary).toBeUndefined();
    expect(runtimeContext.assistantCapabilitySummary).toContain('LOCAL ASSISTANT CAPABILITY SUMMARY');
  });

  it('keeps assistant capability history focused on the latest capability turn', () => {
    const history = buildAssistantCapabilitiesConversationHistoryResult({
      messages: [
        { role: 'user', content: 'Fix the failing auth tests.' },
        { role: 'assistant', content: 'I found the token parser issue in src/auth.ts.' },
        { role: 'tool', content: 'Read src/auth.ts', toolName: 'read', toolArgs: { path: 'src/auth.ts' }, toolResult: '...', success: true },
        { role: 'assistant', content: 'The parser fails on empty bearer tokens.' },
        { role: 'user', content: 'Tu as des skills ?' },
      ],
      includeImages: false,
    });

    expect(history.history).toEqual([
      { role: 'user', content: 'Tu as des skills ?' },
    ]);
    expect(history.metrics.historyStrategy).toBe('assistant_capabilities');
    expect(history.metrics.compactedContextSize).toBe(1);
  });

  it('injects a compact repo-aware snapshot for architecture questions', async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'bun run build' } }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf-8');

    process.chdir(workspace);
    const messages = [{
      role: 'user' as const,
      content: 'Understand the architecture of this project and explain the main components.',
    }];
    const runtimeContext = await buildAgentRuntimeContext(messages);
    const history = buildSmartConversationHistory({
      messages,
      includeImages: false,
      taskModeDecision: runtimeContext.taskModeDecision,
      repoSummary: runtimeContext.repoSummary,
    });

    expect(history[0]?.role).toBe('assistant');
    const snapshot = typeof history[0]?.content === 'string' ? history[0].content : '';
    expect(snapshot).toContain('Task mode: Explore / ReadOnly');
    expect(snapshot).toContain('Repo map:');
    expect(snapshot).toContain('package.json');
    expect(snapshot).toContain('src');
  });
});
