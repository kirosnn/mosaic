import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runProjectDiagnostics } from '../projectDiagnostics.js';
import type { ProjectInfo } from '../types.js';

function makeProjectInfo(directory: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    reactVersion: '^19.0.0',
    reactDomVersion: '^19.0.0',
    framework: 'vite',
    frameworks: ['vite'],
    language: 'typescript',
    packageManager: 'bun',
    packageManagersDetected: ['bun'],
    runtime: 'web',
    isReactNative: false,
    hasReactCompiler: false,
    hasBuildScript: true,
    hasDevScript: true,
    hasTestScript: true,
    hasTestingLibrary: true,
    hasTypeScriptDependency: true,
    hasEslint: true,
    lockfiles: ['bun.lock'],
    packageCount: 1,
    sourceFileCount: 10,
    directory,
    ...overrides,
  };
}

describe('runProjectDiagnostics', () => {
  it('reports bun script mismatches when scripts call npm/pnpm/yarn', () => {
    const root = mkdtempSync(join(tmpdir(), 'nativereact-projectdiag-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          scripts: {
            dev: 'npm run dev:web',
            build: 'bun run build',
          },
        }, null, 2),
        'utf-8',
      );

      const diagnostics = runProjectDiagnostics(makeProjectInfo(root, { packageManager: 'bun' }));
      const ruleIds = diagnostics.map(d => d.rule);
      expect(ruleIds.includes('projectBunScriptsCallOtherManager')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns no diagnostics when categories exclude project', () => {
    const root = mkdtempSync(join(tmpdir(), 'nativereact-projectdiag-filter-'));
    try {
      const diagnostics = runProjectDiagnostics(
        makeProjectInfo(root, { hasDevScript: false }),
        ['bugs', 'performance'],
      );
      expect(diagnostics.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
