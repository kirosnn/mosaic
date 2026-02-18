import { describe, expect, it } from 'bun:test';
import { reactNativeRules } from '../rules/reactNative.js';
import type { ProjectInfo, SourceFile } from '../types.js';

function makeSourceFile(content: string): SourceFile {
  return {
    path: 'src/App.tsx',
    content,
    lines: content.split('\n'),
    ext: '.tsx',
    isClientComponent: false,
    isServerComponent: false,
    isTest: false,
    isJsx: true,
  };
}

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

describe('reactNativeRules', () => {
  it('does not trigger in non-react-native projects', () => {
    const file = makeSourceFile('export default function App(){return <div>Hello world</div>}');
    const projectInfo = makeProjectInfo({ isReactNative: false });

    const total = reactNativeRules.reduce((sum, rule) => sum + rule.check(file, projectInfo).length, 0);
    expect(total).toBe(0);
  });
});
