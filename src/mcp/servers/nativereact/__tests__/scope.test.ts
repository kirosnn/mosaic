import { describe, expect, it } from 'bun:test';
import { isLikelyReactFile, shouldAnalyzeFile } from '../scope.js';
import type { ProjectInfo, SourceFile } from '../types.js';

function makeProjectInfo(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
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
    sourceFileCount: 1,
    directory: '.',
    ...overrides,
  };
}

function makeFile(path: string, ext: string, content: string, isTest = false): SourceFile {
  return {
    path,
    ext,
    content,
    lines: content.split('\n'),
    isClientComponent: false,
    isServerComponent: false,
    isTest,
    isJsx: ext === '.tsx' || ext === '.jsx',
  };
}

describe('scope', () => {
  it('detects React files through imports and hooks', () => {
    const project = makeProjectInfo();
    const file = makeFile(
      'src/components/Card.ts',
      '.ts',
      "import { useEffect } from 'react'; export function Card(){ useEffect(()=>{},[]); return null; }",
    );
    expect(isLikelyReactFile(file, project)).toBe(true);
    expect(shouldAnalyzeFile(file, project, 'smart')).toBe(true);
  });

  it('skips non-react backend files in smart mode', () => {
    const project = makeProjectInfo();
    const file = makeFile(
      'src/agent/tools/executor.ts',
      '.ts',
      "export async function executeTool() { const data = await fetch('https://example.com'); return data; }",
    );
    expect(isLikelyReactFile(file, project)).toBe(false);
    expect(shouldAnalyzeFile(file, project, 'smart')).toBe(false);
    expect(shouldAnalyzeFile(file, project, 'full')).toBe(true);
  });

  it('skips tests in smart mode', () => {
    const project = makeProjectInfo();
    const file = makeFile(
      'src/components/App.test.tsx',
      '.tsx',
      "import { render } from '@testing-library/react';",
      true,
    );
    expect(shouldAnalyzeFile(file, project, 'smart')).toBe(false);
    expect(shouldAnalyzeFile(file, project, 'full')).toBe(true);
  });
});
