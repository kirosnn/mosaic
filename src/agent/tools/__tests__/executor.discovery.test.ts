import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeTool } from '../executor';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mosaic-discovery-'));
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

describe('executor discovery', () => {
  it('lists directories and files recursively with workspace-relative paths', async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src', 'nested'), { recursive: true });
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf-8');
    writeFileSync(join(workspace, 'src', 'nested', 'feature.ts'), 'export const feature = true;\n', 'utf-8');
    writeFileSync(join(workspace, 'docs', 'readme.md'), '# Docs\n', 'utf-8');

    process.chdir(workspace);
    const result = await executeTool('list', { path: '.', recursive: true });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.result || '{}') as { files?: Array<{ path: string; type: string }> };
    const paths = (parsed.files ?? []).map((entry) => `${entry.type}:${entry.path}`).sort();

    expect(paths).toContain('directory:docs');
    expect(paths).toContain('directory:src');
    expect(paths).toContain('directory:src/nested');
    expect(paths).toContain('file:docs/readme.md');
    expect(paths).toContain('file:src/index.ts');
    expect(paths).toContain('file:src/nested/feature.ts');
  });

  it('applies recursive filters against relative subpaths instead of only basenames', async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src', 'nested'), { recursive: true });
    mkdirSync(join(workspace, 'test'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'nested', 'feature.ts'), 'export const feature = true;\n', 'utf-8');
    writeFileSync(join(workspace, 'test', 'feature.test.ts'), 'export const testValue = true;\n', 'utf-8');

    process.chdir(workspace);
    const result = await executeTool('list', { path: '.', recursive: true, filter: 'src/**/*.ts' });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.result || '{}') as { files?: Array<{ path: string; type: string }> };
    const filePaths = (parsed.files ?? [])
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path)
      .sort();

    expect(filePaths).toEqual(['src/nested/feature.ts']);
  });

  it('truncates recursive listing and returns directory summary when entries exceed 300', async () => {
    const workspace = createWorkspace();
    for (let i = 0; i < 10; i++) {
      mkdirSync(join(workspace, `pkg${i}`, 'src'), { recursive: true });
      for (let j = 0; j < 35; j++) {
        writeFileSync(join(workspace, `pkg${i}`, 'src', `file${j}.ts`), '', 'utf-8');
      }
    }

    process.chdir(workspace);
    const result = await executeTool('list', { path: '.', recursive: true });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.result || '{}') as {
      truncated?: boolean;
      totalEntries?: number;
      topLevelBreakdown?: Record<string, { files: number; dirs: number }>;
    };
    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.totalEntries).toBe('number');
    expect(parsed.totalEntries).toBeGreaterThan(300);
    expect(parsed.topLevelBreakdown).toBeDefined();
    expect(Object.keys(parsed.topLevelBreakdown ?? {}).length).toBeGreaterThan(0);

    const raw = result.result ?? '';
    expect(raw.length).toBeLessThan(4000);
  });

  it('returns glob results relative to the requested search path', async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src', 'nested'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'root.ts'), 'export const root = true;\n', 'utf-8');
    writeFileSync(join(workspace, 'src', 'nested', 'child.ts'), 'export const child = true;\n', 'utf-8');

    process.chdir(workspace);
    const result = await executeTool('glob', { path: 'src', pattern: '**/*.ts' });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.result || '[]') as string[];
    expect(parsed).toEqual(['nested/child.ts', 'root.ts']);
  });
});
