import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSmartConversationHistory } from '../context';
import { buildAgentRuntimeContext } from '../runtimeContext';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mosaic-context-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildSmartConversationHistory', () => {
  it('injects a compact repo-aware snapshot for architecture questions', () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'bun run build' } }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf-8');

    process.chdir(workspace);
    const messages = [{
      role: 'user' as const,
      content: 'Understand the architecture of this project and explain the main components.',
    }];
    const runtimeContext = buildAgentRuntimeContext(messages);
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
