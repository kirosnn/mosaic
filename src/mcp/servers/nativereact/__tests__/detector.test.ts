import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectProject } from '../detector.js';

const tempDirs: string[] = [];

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nativereact-detector-'));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('detectProject', () => {
  it('detects bun + vite web projects', () => {
    const root = createTempProject();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeJson(join(root, 'package.json'), {
      name: 'vite-app',
      packageManager: 'bun@1.3.0',
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        vite: '^7.0.0',
      },
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest',
      },
      devDependencies: {
        typescript: '^5.7.0',
        vitest: '^3.0.0',
        eslint: '^9.0.0',
      },
    });
    writeFileSync(join(root, 'bun.lock'), '', 'utf-8');
    writeFileSync(join(root, 'src', 'main.tsx'), 'export default function App(){return <div />}', 'utf-8');

    const info = detectProject(root, 1, [join(root, 'src', 'main.tsx')]);

    expect(info.framework).toBe('vite');
    expect(info.packageManager).toBe('bun');
    expect(info.runtime).toBe('web');
    expect(info.reactVersion).toBe('^19.0.0');
    expect(info.reactDomVersion).toBe('^19.0.0');
    expect(info.hasDevScript).toBe(true);
    expect(info.hasBuildScript).toBe(true);
  });

  it('detects framework from workspace package when root has no react deps', () => {
    const root = createTempProject();
    const appDir = join(root, 'apps', 'web');
    mkdirSync(join(appDir, 'app'), { recursive: true });

    writeJson(join(root, 'package.json'), {
      name: 'monorepo-root',
      private: true,
      workspaces: ['apps/*'],
    });

    writeJson(join(appDir, 'package.json'), {
      name: 'web-app',
      dependencies: {
        next: '^16.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      scripts: {
        dev: 'next dev',
      },
    });

    const pageFile = join(appDir, 'app', 'page.tsx');
    writeFileSync(pageFile, "export default function Page(){return <main>Hello</main>}", 'utf-8');

    const info = detectProject(root, 1, [pageFile]);

    expect(info.framework).toBe('nextjs');
    expect(info.frameworks.includes('nextjs')).toBe(true);
    expect(info.reactVersion).toBe('^19.0.0');
    expect(info.reactDomVersion).toBe('^19.0.0');
    expect(info.packageCount).toBeGreaterThanOrEqual(2);
  });
});
