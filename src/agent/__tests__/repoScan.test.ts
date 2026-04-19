import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearRepositoryScanCache, formatArchitectureSummary, scanRepository } from '../repoScan';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mosaic-repo-scan-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);
  clearRepositoryScanCache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanRepository', () => {
  it('builds a deterministic repository summary with commands and entrypoints', () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, '.git'), { recursive: true });
    mkdirSync(join(workspace, 'src'), { recursive: true });
    mkdirSync(join(workspace, 'apps', 'web', 'app'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({
      scripts: {
        dev: 'bun run dev',
        build: 'bun run build',
        test: 'bun test',
        lint: 'bunx tsc --noEmit',
      },
    }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'tsconfig.json'), '{}\n', 'utf-8');
    writeFileSync(join(workspace, 'src', 'main.ts'), 'console.log("main");\n', 'utf-8');
    writeFileSync(join(workspace, 'apps', 'web', 'app', 'page.tsx'), 'export default function Page(){return null;}\n', 'utf-8');

    process.chdir(workspace);
    const summary = scanRepository();

    expect(summary.cacheHit).toBe(false);
    expect(summary.projectRoots.some((root) => root.path === '.')).toBe(true);
    expect(summary.manifests).toContain('package.json');
    expect(summary.architectureFiles).toContain('tsconfig.json');
    expect(summary.entrypoints).toContain('src/main.ts');
    expect(summary.entrypoints).toContain('apps/web/app/page.tsx');
    expect(summary.commands.dev.length).toBeGreaterThan(0);
    expect(summary.commands.build.length).toBeGreaterThan(0);
    expect(summary.topLevelDirectories).toContain('src');
    expect(summary.topLevelDirectories).toContain('apps');
  });

  it('prefers the declared package manager when generating command hints', () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({
      packageManager: 'bun@1.3.10',
      scripts: {
        dev: 'bun run dev',
        test: 'bun test',
      },
    }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'bun.lock'), '', 'utf-8');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf-8');

    process.chdir(workspace);
    const summary = scanRepository();

    expect(summary.commands.install).toEqual(['bun install']);
    expect(summary.commands.dev).toContain('bun run dev');
    expect(summary.commands.dev.some((command) => command.includes('npm run'))).toBe(false);
  });

  it('formatArchitectureSummary produces a ranked compact summary within the char budget', () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, '.git'), { recursive: true });
    mkdirSync(join(workspace, 'src'), { recursive: true });
    mkdirSync(join(workspace, 'tests'), { recursive: true });
    mkdirSync(join(workspace, 'tools'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'bun dev', build: 'bun build', test: 'bun test' } }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'tsconfig.json'), '{}', 'utf-8');
    writeFileSync(join(workspace, 'src', 'main.ts'), '', 'utf-8');

    process.chdir(workspace);
    const summary = scanRepository();
    const text = formatArchitectureSummary(summary, 2400);

    expect(text.length).toBeLessThanOrEqual(2400);
    expect(text).toContain('Primary project');
    expect(text).toContain('package.json');
    expect(text).toContain('main.ts');
    expect(text.toLowerCase()).toContain('do not recursively list');
  });

  it('reuses the cached summary when the workspace signature is unchanged', () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'bun run build' } }, null, 2), 'utf-8');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf-8');

    process.chdir(workspace);
    const first = scanRepository();
    const second = scanRepository();

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.manifests).toEqual(first.manifests);
    expect(second.entrypoints).toEqual(first.entrypoints);
  });
});
