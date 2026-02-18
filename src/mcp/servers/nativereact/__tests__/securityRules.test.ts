import { describe, expect, it } from 'bun:test';
import { securityRules } from '../rules/security.js';
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

function makeFile(path: string, ext: string, content: string): SourceFile {
  return {
    path,
    ext,
    content,
    lines: content.split('\n'),
    isClientComponent: false,
    isServerComponent: false,
    isTest: false,
    isJsx: ext === '.tsx' || ext === '.jsx',
  };
}

describe('securityRules', () => {
  it('does not flag server entrypoints for client env exposure', () => {
    const rule = securityRules.find(r => r.id === 'noSecretsInClientCode');
    expect(rule).toBeTruthy();
    const file = makeFile(
      'src/web/server.tsx',
      '.tsx',
      'const value = process.env.MOSAIC_PROJECT_PATH; export default value;',
    );
    const violations = rule!.check(file, makeProjectInfo());
    const hasClientEnvWarning = violations.some(v => v.message.includes('may be exposed in client bundle'));
    expect(hasClientEnvWarning).toBe(false);
  });

  it('flags client component env exposure', () => {
    const rule = securityRules.find(r => r.id === 'noSecretsInClientCode');
    expect(rule).toBeTruthy();
    const file = makeFile(
      'src/web/components/App.tsx',
      '.tsx',
      "'use client';\nconst value = process.env.INTERNAL_SECRET;\nexport default function App(){return <div>{value}</div>}",
    );
    file.isClientComponent = true;
    const violations = rule!.check(file, makeProjectInfo());
    const hasClientEnvWarning = violations.some(v => v.message.includes('may be exposed in client bundle'));
    expect(hasClientEnvWarning).toBe(true);
  });
});
