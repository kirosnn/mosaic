import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { __test__ as executorTest, executeTool } from '../executor';
import { resolveToolPath } from '../../toolPathScope';

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

  it('supports targeted reads outside the workspace when the path is explicit', async () => {
    const workspace = createWorkspace();
    const externalRoot = createWorkspace();
    const externalFile = join(externalRoot, 'notes-config.json');
    writeFileSync(externalFile, '{"enabled":true}\n', 'utf-8');

    process.chdir(workspace);
    const result = await executeTool('read', { path: externalFile }, { skipApproval: true });
    expect(result.success).toBe(true);
    expect(result.result).toContain('"enabled":true');
  });

  it('classifies absolute paths outside the workspace without treating them as repo-relative', async () => {
    const workspace = createWorkspace();
    const externalRoot = createWorkspace();
    const pathInfo = await resolveToolPath(workspace, join(externalRoot, 'config.toml'));

    expect(pathInfo.withinWorkspace).toBe(false);
    expect(pathInfo.workspaceRelativePath).toBeNull();
    expect(pathInfo.displayPath).toContain('config.toml');
  });

  it('returns a structured local summary for common git inspection commands', () => {
    const parsed = JSON.parse(executorTest.formatStructuredGitInspection([
      {
        command: 'git status --short --branch',
        output: '## main...origin/main [ahead 2, behind 1]\n M tracked.txt\n?? new.txt\n',
      },
      {
        command: 'git remote -v',
        output: 'origin\thttps://example.com/repo.git (fetch)\norigin\thttps://example.com/repo.git (push)\n',
      },
      {
        command: 'git branch -vv',
        output: '* main a717c4e [origin/main: ahead 2, behind 1] init\n  feature 1234567 feature work\n',
      },
    ])) as {
      summary?: {
        currentBranch?: string;
        upstreamBranch?: string;
        aheadCount?: number;
        behindCount?: number;
        modifiedCount?: number;
        untrackedCount?: number;
        keyChangedPaths?: string[];
        remotes?: Array<{ name: string; fetch?: string; push?: string }>;
        branchTrackingInfo?: Array<{ branch: string; isCurrent?: boolean }>;
      };
      raw?: Array<{ command: string; output: string }>;
    };

    expect(parsed.summary?.currentBranch).toBe('main');
    expect(parsed.summary?.upstreamBranch).toBe('origin/main');
    expect(parsed.summary?.aheadCount).toBe(2);
    expect(parsed.summary?.behindCount).toBe(1);
    expect(parsed.summary?.modifiedCount).toBe(1);
    expect(parsed.summary?.untrackedCount).toBe(1);
    expect(parsed.summary?.keyChangedPaths).toContain('tracked.txt');
    expect(parsed.summary?.keyChangedPaths).toContain('new.txt');
    expect(parsed.summary?.remotes).toEqual([
      {
        name: 'origin',
        fetch: 'https://example.com/repo.git',
        push: 'https://example.com/repo.git',
      },
    ]);
    expect(parsed.summary?.branchTrackingInfo?.some((entry) => entry.branch === 'main' && entry.isCurrent)).toBe(true);
    expect(parsed.raw?.map((entry) => entry.command)).toEqual([
      'git status --short --branch',
      'git remote -v',
      'git branch -vv',
    ]);
  });
});
